import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySafeRepairs,
  normalizeLocale,
  redactText,
  redactReport,
  scanMcpConfigurations,
  translate,
  type ConfigCandidate
} from "./index.js";

describe("localization", () => {
  it("normalizes supported locales", () => {
    expect(normalizeLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("de-DE")).toBe("en");
  });

  it("interpolates translated values", () => {
    expect(
      translate("zh-CN", "status.configuredServers", { count: 3 })
    ).toContain("3");
    expect(translate("ja", "action.scan")).toBe("今すぐ診断");
  });
});

describe("privacy", () => {
  it("redacts common secrets and the home path", () => {
    const input =
      'token="github_pat_abcdefghijklmnopqrstuvwxyz123456" C:\\Users\\Alice\\project';
    const output = redactText(input, "C:\\Users\\Alice");
    expect(output).not.toContain("github_pat_");
    expect(output).not.toContain("C:\\Users\\Alice");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts paths inside structured reports", async () => {
    const report = await scanMcpConfigurations({
      platform: "win32",
      homeDir: "C:\\Users\\Alice",
      appDataDir: "C:\\Users\\Alice\\AppData\\Roaming"
    });
    const redacted = redactReport(report, "C:\\Users\\Alice");
    expect(JSON.stringify(redacted)).not.toContain("Alice");
    expect(redacted.clients[0].configPath.startsWith("~")).toBe(true);
  });
});

describe("scan and safe repair", () => {
  it("finds and safely wraps npx on Windows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpulse-test-"));
    const configPath = path.join(root, "mcp.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `{
  // This comment must survive the repair.
  "mcpServers": {
    "demo": {
      "command": "npx",
      "args": ["-y", "@example/mcp"]
    }
  }
}
`,
      "utf8"
    );

    const candidates: ConfigCandidate[] = [
      {
        clientId: "cursor",
        displayName: "Cursor",
        path: configPath,
        format: "jsonc"
      }
    ];

    const report = await scanMcpConfigurations({
      platform: "win32",
      candidates
    });
    expect(report.summary.safeRepairs).toBe(1);
    expect(report.repairs[0].after.args.slice(0, 4)).toEqual([
      "/d",
      "/s",
      "/c",
      "npx"
    ]);

    const backupRoot = path.join(root, "backups");
    const result = await applySafeRepairs(report.repairs, { backupRoot });
    expect(result.results[0].applied).toBe(true);

    const repaired = await readFile(configPath, "utf8");
    expect(repaired).toContain("This comment must survive");
    expect(repaired).toContain('"command": "cmd"');

    const rescanned = await scanMcpConfigurations({
      platform: "win32",
      candidates
    });
    expect(rescanned.summary.safeRepairs).toBe(0);
  });
});
