import os from "node:os";
import process from "node:process";
import {
  applySafeRepairs,
  describeProbeTarget,
  normalizeLocale,
  planProbeTargets,
  probeMcpConfigurations,
  redactReport,
  redactText,
  scanMcpConfigurations,
  translate,
  type Locale,
  type ScanReport
} from "@mcpulse/core";

function argValue(name: string): string | undefined {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2]?.startsWith("-") ? "scan" : process.argv[2] ?? "scan";
const locale: Locale = normalizeLocale(
  argValue("--lang") ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale
);
const json = process.argv.includes("--json");
const VERSION = "0.2.0";

function t(key: string, params?: Record<string, string | number>): string {
  return translate(locale, key, params);
}

function statusFor(client: ScanReport["clients"][number]): string {
  if (!client.configFound) return t("status.notConfigured");
  if (client.findings.some((finding) => finding.severity === "error")) {
    return t("status.error");
  }
  if (client.findings.some((finding) => finding.severity === "warning")) {
    return t("status.warning");
  }
  return t("status.healthy");
}

function printHuman(report: ScanReport): void {
  process.stdout.write(`${t("app.name")} — ${t("app.tagline")}\n\n`);
  for (const client of report.clients) {
    process.stdout.write(
      `${client.displayName.padEnd(16)} ${statusFor(client)} · ${t(
        "status.configuredServers",
        { count: client.serverCount }
      )}\n`
    );
    for (const finding of client.findings.filter(
      (item) => item.severity !== "info"
    )) {
      process.stdout.write(
        `  ${finding.severity === "error" ? "×" : "!"} ${t(
          finding.titleKey,
          finding.detailParams
        )}\n`
      );
    }
  }
  process.stdout.write(
    `\n${t("summary.clients")}: ${report.summary.detectedClients}  ` +
      `${t("summary.servers")}: ${report.summary.configuredServers}  ` +
      `${t("summary.problems")}: ${
        report.summary.errors + report.summary.warnings
      }  ` +
      `${t("summary.safeRepairs")}: ${report.summary.safeRepairs}\n`
  );
  process.stdout.write(`${t("privacy.localOnly")}\n`);
}

function printHelp(): void {
  process.stdout.write(
    `MCPulse ${VERSION}\n\n` +
      `${t("cli.usage")}\n\n` +
      `  mcpulse scan [--lang en|zh-CN|ja] [--json]\n` +
      `  mcpulse probe [--run] [--timeout 8000] [--server name] [--json]\n` +
      `  mcpulse repair [--apply-safe] [--json]\n\n` +
      `${t("cli.scanHelp")}\n` +
      `${t("cli.probeHelp")}\n` +
      `${t("cli.repairHelp")}\n`
  );
}

function probeStatusLabel(status: string): string {
  const keys: Record<string, string> = {
    connected: "probe.connected",
    "auth-required": "probe.authRequired",
    timeout: "probe.timeout",
    "not-found": "probe.notFound",
    failed: "probe.failed",
    unsupported: "probe.unsupported"
  };
  return t(keys[status] ?? "probe.failed");
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (
    command === "help" ||
    process.argv.includes("--help") ||
    process.argv.includes("-h")
  ) {
    printHelp();
    return;
  }

  if (command === "probe") {
    const run = process.argv.includes("--run");
    const timeout = Number(argValue("--timeout") ?? "8000");
    const selected = process.argv
      .filter((arg) => arg.startsWith("--server="))
      .map((arg) => arg.slice("--server=".length));
    const separateServer = argValue("--server");
    if (separateServer && !selected.includes(separateServer)) {
      selected.push(separateServer);
    }

    if (!run) {
      const targets = await planProbeTargets();
      if (json) {
        process.stdout.write(
          `${JSON.stringify(redactReport(targets, os.homedir()), null, 2)}\n`
        );
      } else if (targets.length === 0) {
        process.stdout.write(`${t("probe.none")}\n`);
      } else {
        process.stdout.write(
          `${t("probe.previewTitle")}\n${t("probe.safety")}\n\n`
        );
        for (const target of targets) {
          process.stdout.write(
            `${target.clientName} / ${target.server.name}\n` +
              `  ${redactText(describeProbeTarget(target.server), os.homedir())}\n`
          );
        }
        process.stdout.write(`\n${t("cli.probeRunHint")}\n`);
      }
      return;
    }

    const probe = await probeMcpConfigurations({
      timeoutMs: Number.isFinite(timeout) ? timeout : 8_000,
      serverNames: selected
    });
    if (json) {
      process.stdout.write(
        `${JSON.stringify(redactReport(probe, os.homedir()), null, 2)}\n`
      );
    } else {
      for (const result of probe.results) {
        const detail =
          result.status === "connected"
            ? result.toolCount === undefined
              ? t("probe.noTools")
              : t("probe.tools", { count: result.toolCount })
            : result.detail ?? "";
        process.stdout.write(
          `${result.status === "connected" ? "✓" : "×"} ` +
            `${result.clientName} / ${result.serverName} — ` +
            `${probeStatusLabel(result.status)} (${result.durationMs} ms)` +
            `${detail ? `\n  ${detail}` : ""}\n`
        );
      }
      process.stdout.write(
        `\n${t("probe.complete", {
          connected: probe.summary.connected,
          total: probe.summary.total
        })}\n`
      );
    }
    if (probe.summary.failed > 0 || probe.summary.authRequired > 0) {
      process.exitCode = 2;
    }
    return;
  }

  const report = await scanMcpConfigurations();

  if (command === "repair") {
    if (process.argv.includes("--apply-safe")) {
      const result = await applySafeRepairs(report.repairs);
      if (json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        for (const item of result.results) {
          process.stdout.write(
            `${item.applied ? "✓" : "!"} ${t(item.messageKey)} ${item.configPath}\n`
          );
        }
      }
      return;
    }

    if (json) {
      process.stdout.write(`${JSON.stringify(report.repairs, null, 2)}\n`);
    } else if (report.repairs.length === 0) {
      process.stdout.write(`${t("summary.safeRepairs")}: 0\n`);
    } else {
      process.stdout.write(`${t("repair.previewTitle")}\n\n`);
      for (const repair of report.repairs) {
        process.stdout.write(
          `${repair.clientName} / ${repair.serverName}\n` +
            `  ${t(repair.titleKey)}\n` +
            `  ${t("repair.before")}: ${repair.before.command} ${repair.before.args.join(" ")}\n` +
            `  ${t("repair.after")}: ${repair.after.command} ${repair.after.args.join(" ")}\n\n`
        );
      }
    }
    return;
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify(redactReport(report, os.homedir()), null, 2)}\n`
    );
  } else {
    printHuman(report);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
