import os from "node:os";
import process from "node:process";
import {
  applySafeRepairs,
  normalizeLocale,
  redactReport,
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

async function main(): Promise<void> {
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
