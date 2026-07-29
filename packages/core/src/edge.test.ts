import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySafeRepairs,
  probeMcpConfigurations,
  redactReport,
  redactText,
  rollbackRepair,
  scanMcpConfigurations,
  type ConfigCandidate
} from "./index.js";

function candidate(configPath: string): ConfigCandidate {
  return {
    clientId: "cursor",
    displayName: "Cursor",
    path: configPath,
    format: "jsonc"
  };
}

describe("probe failure boundaries", () => {
  it("times out a silent stdio server and closes it promptly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-timeout-"));
    const serverPath = path.join(root, "silent-server.mjs");
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      serverPath,
      "process.stdin.resume(); setInterval(() => {}, 1000);\n",
      "utf8"
    );
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          silent: {
            command: process.execPath,
            args: [serverPath],
            env: { API_KEY: "sk-abcdefghijklmnopqrstuv" }
          }
        }
      }),
      "utf8"
    );

    const startedAt = Date.now();
    const report = await probeMcpConfigurations({
      timeoutMs: 1_000,
      scanOptions: { candidates: [candidate(configPath)] }
    });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.summary).toEqual({
      total: 1,
      connected: 0,
      authRequired: 0,
      failed: 1
    });
    expect(report.results[0]).toMatchObject({
      serverName: "silent",
      status: "timeout",
      messageKey: "probe.timeout"
    });
    expect(JSON.stringify(report)).not.toContain(
      "sk-abcdefghijklmnopqrstuv"
    );
  }, 10_000);

  it("classifies a 401 Streamable HTTP response as auth-required", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer"
      });
      response.end(JSON.stringify({ error: "authorization required" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind");
      }
      const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-auth-"));
      const configPath = path.join(root, "mcp.json");
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            private: {
              url: `http://127.0.0.1:${address.port}/mcp`,
              headers: {
                Authorization: "Bearer abcdefghijklmnopqrstuvwxyz"
              }
            }
          }
        }),
        "utf8"
      );

      const report = await probeMcpConfigurations({
        timeoutMs: 2_000,
        scanOptions: { candidates: [candidate(configPath)] }
      });
      expect(report.summary.authRequired).toBe(1);
      expect(report.summary.failed).toBe(0);
      expect(report.results[0]).toMatchObject({
        status: "auth-required",
        messageKey: "probe.authRequired"
      });
      expect(JSON.stringify(report)).not.toContain(
        "abcdefghijklmnopqrstuvwxyz"
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

describe("redaction boundaries", () => {
  it("redacts secret keys, token families, bearer values, and path variants", () => {
    const home = "C:\\Users\\Alice";
    const input = [
      'password = "correct-horse-battery-staple"',
      "api_key: sk-abcdefghijklmnopqrstuv",
      "Authorization=Bearer abcdefghijklmnopqrstuvwxyz",
      "gho_abcdefghijklmnopqrstuvwx",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456",
      `${home}\\project`,
      `${home.replaceAll("\\", "/")}/other`
    ].join("\n");
    const redacted = redactText(input, home);

    for (const secret of [
      "correct-horse-battery-staple",
      "sk-abcdefghijklmnopqrstuv",
      "abcdefghijklmnopqrstuvwxyz",
      "gho_abcdefghijklmnopqrstuvwx",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456",
      "C:\\Users\\Alice",
      "C:/Users/Alice"
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(5);
    expect(redacted).toContain("~/project");
    expect(redacted).toContain("~/other");
  });

  it("does not mutate the original structured report while redacting it", () => {
    const source = {
      nested: {
        token: "sk-abcdefghijklmnopqrstuv",
        path: "C:\\Users\\Alice\\project"
      }
    };
    const redacted = redactReport(source, "C:\\Users\\Alice");
    expect(redacted).not.toBe(source);
    expect(redacted.nested).not.toBe(source.nested);
    expect(redacted.nested.token).toContain("[REDACTED]");
    expect(source.nested.token).toBe("sk-abcdefghijklmnopqrstuv");
  });
});

describe("repair transaction boundaries", () => {
  it("skips stale repairs without overwriting a changed configuration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-stale-"));
    const configPath = path.join(root, "mcp.json");
    const original = JSON.stringify({
      mcpServers: {
        demo: { command: "npx", args: ["-y", "@example/mcp"] }
      }
    });
    await writeFile(configPath, original, "utf8");
    const report = await scanMcpConfigurations({
      platform: "win32",
      candidates: [candidate(configPath)]
    });
    const changed = `${original}\n// user changed this after the scan\n`;
    await writeFile(configPath, changed, "utf8");

    const result = await applySafeRepairs(report.repairs, {
      backupRoot: path.join(root, "backups")
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      applied: false,
      messageKey: "repair.skippedChanged"
    });
    expect(await readFile(configPath, "utf8")).toBe(changed);
  });

  it("batches same-file repairs into one backup and supports rollback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-batch-"));
    const configPath = path.join(root, "mcp.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    const original = `{
  // Preserve this comment.
  "mcpServers": {
    "first": { "command": "npx", "args": ["-y", "@example/one"] },
    "second": { "command": "npx", "args": ["-y", "@example/two"] }
  }
}
`;
    await writeFile(configPath, original, "utf8");
    const report = await scanMcpConfigurations({
      platform: "win32",
      candidates: [candidate(configPath)]
    });
    expect(report.repairs).toHaveLength(2);

    const result = await applySafeRepairs(report.repairs, {
      backupRoot: path.join(root, "backups")
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((item) => item.applied)).toBe(true);
    const backupPaths = new Set(
      result.results.map((item) => item.backupPath)
    );
    expect(backupPaths.size).toBe(1);
    const repaired = await readFile(configPath, "utf8");
    expect(repaired.match(/"command": "cmd"/g)).toHaveLength(2);
    expect(repaired).toContain("Preserve this comment");

    const backupPath = result.results[0].backupPath;
    if (!backupPath) throw new Error("Expected a repair backup");
    await rollbackRepair(backupPath, configPath);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});
