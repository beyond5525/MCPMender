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
} from "@mcpmender/core";
import { parseCliArguments } from "./args.js";

let cli: ReturnType<typeof parseCliArguments>;
try {
  cli = parseCliArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
const command = cli.command;
const locale: Locale = normalizeLocale(
  cli.lang ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale
);
const json = cli.json;
const VERSION = "0.3.0-beta.2";

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
        `  ${finding.severity === "error" ? "✗" : "!"} ${t(
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
    `MCPMender ${VERSION}\n\n` +
      `${t("cli.usage")}\n\n` +
      `  mcpmender scan [--lang en|zh-CN|ja] [--json]\n` +
      `  mcpmender probe [--run] [--timeout 8000] [--server name] [--json]\n` +
      `  mcpmender repair [--apply-safe] [--json]\n\n` +
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
  if (cli.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (
    cli.help
  ) {
    printHelp();
    return;
  }
  if (command === "probe") {
    const run = cli.run;
    const timeout = cli.timeout;
    const selected = [...new Set(cli.servers)];

    if (!run) {
      const allTargets = await planProbeTargets();
      const availableNames = new Set(
        allTargets.map((target) => target.server.name)
      );
      const missingNames = selected.filter((name) => !availableNames.has(name));
      if (missingNames.length > 0) {
        throw new Error(
          `No configured server matched: ${missingNames.join(", ")}`
        );
      }
      const targets =
        selected.length === 0
          ? allTargets
          : allTargets.filter((target) => selected.includes(target.server.name));
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
      timeoutMs: timeout,
      serverNames: selected
    });
    if (selected.length > 0 && probe.summary.total === 0) {
      throw new Error(`No configured server matched: ${selected.join(", ")}`);
    }
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
          `${result.status === "connected" ? "✓" : "✗"} ` +
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
    if (cli.applySafe) {
      const result = await applySafeRepairs(report.repairs);
      if (json) {
        process.stdout.write(
          `${JSON.stringify(redactReport(result, os.homedir()), null, 2)}\n`
        );
      } else {
        for (const item of result.results) {
          const safeItem = redactReport(item, os.homedir());
          process.stdout.write(
            `${safeItem.applied ? "✓" : "!"} ${t(safeItem.messageKey)} ${safeItem.configPath}\n`
          );
          if (safeItem.backupPath) {
            process.stdout.write(`  Backup: ${safeItem.backupPath}\n`);
          }
        }
        process.stdout.write(`Transaction: ${result.transactionId}\n`);
      }
      if (result.results.some((item) => !item.applied)) process.exitCode = 3;
      return;
    }

    if (json) {
      process.stdout.write(
        `${JSON.stringify(redactReport(report.repairs, os.homedir()), null, 2)}\n`
      );
    } else if (report.repairs.length === 0) {
      process.stdout.write(`${t("summary.safeRepairs")}: 0\n`);
    } else {
      process.stdout.write(`${t("repair.previewTitle")}\n\n`);
      for (const repair of report.repairs) {
        const safeRepair = redactReport(repair, os.homedir());
        process.stdout.write(
          `${safeRepair.clientName} / ${safeRepair.serverName}\n` +
            `  ${t(safeRepair.titleKey)}\n` +
            `  ${t("repair.before")}: ${safeRepair.before.command} ${safeRepair.before.args.join(" ")}\n` +
            `  ${t("repair.after")}: ${safeRepair.after.command} ${safeRepair.after.args.join(" ")}\n\n`
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
  if (report.summary.errors > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
