import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySafeRepairs,
  normalizeLocale,
  planProbeTargets,
  redactText,
  redactReport,
  probeMcpConfigurations,
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
    expect(
      translate("zh-CN", "scan.complete", { clients: 2, problems: 1 })
    ).toContain("2");
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

  it("does not expose configured secrets in a probe preview", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-preview-"));
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          private: {
            command: process.execPath,
            args: ["--token=sk-abcdefghijklmnopqrstuv"],
            env: { API_KEY: "sk-abcdefghijklmnopqrstuv" },
            headers: {
              Authorization: "Bearer abcdefghijklmnopqrstuvwxyz"
            }
          }
        }
      }),
      "utf8"
    );
    const targets = await planProbeTargets({
      candidates: [
        {
          clientId: "cursor",
          displayName: "Cursor",
          path: configPath,
          format: "jsonc"
        }
      ]
    });
    const serialized = JSON.stringify(targets);
    expect(serialized).not.toContain("abcdefghijklmnopqrstuv");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("API_KEY");
  });
});

describe("scan and safe repair", () => {
  it("finds and safely wraps npx on Windows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-test-"));
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

  it("uses platform-specific configuration paths", async () => {
    const report = await scanMcpConfigurations({
      platform: "darwin",
      homeDir: "/Users/alice",
      projectDir: "/Users/alice/project"
    });
    const claude = report.clients.find(
      (client) => client.clientId === "claude-desktop"
    );
    expect(claude?.configPath).toBe(
      "/Users/alice/Library/Application Support/Claude/claude_desktop_config.json"
    );
    const desktopReport = await scanMcpConfigurations({
      platform: "darwin",
      homeDir: "/Users/alice",
      skipProjectConfigs: true
    });
    expect(
      desktopReport.clients.some((client) => client.clientId === "vscode")
    ).toBe(false);
  });

  it("reports missing commands, variables, and invalid URLs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-static-"));
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          missing: {
            command: "definitely-not-a-real-mcp-command",
            args: ["${MCPMENDER_TEST_MISSING}"]
          },
          remote: { url: "file:///not-an-http-endpoint" }
        }
      }),
      "utf8"
    );
    const report = await scanMcpConfigurations({
      candidates: [
        {
          clientId: "cursor",
          displayName: "Cursor",
          path: configPath,
          format: "jsonc"
        }
      ]
    });
    expect(report.findings.map((finding) => finding.titleKey)).toEqual(
      expect.arrayContaining([
        "scan.commandMissing.title",
        "scan.envMissing.title",
        "scan.urlInvalid.title"
      ])
    );
  });

  it("performs a real stdio MCP initialize handshake", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-probe-"));
    const serverPath = path.join(root, "fake-mcp-server.mjs");
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      serverPath,
      `import readline from "node:readline";
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "mcpmender-test-server", version: "1.0.0" }
      }
    }) + "\\n");
  } else if (message.method === "tools/list") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [] }
    }) + "\\n");
  }
});
`,
      "utf8"
    );
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          test: { command: process.execPath, args: [serverPath] }
        }
      }),
      "utf8"
    );

    const report = await probeMcpConfigurations({
      timeoutMs: 5_000,
      scanOptions: {
        candidates: [
          {
            clientId: "cursor",
            displayName: "Cursor",
            path: configPath,
            format: "jsonc"
          }
        ]
      }
    });
    expect(report.summary.connected).toBe(1);
    expect(report.results[0]).toMatchObject({
      status: "connected",
      serverNameReported: "mcpmender-test-server",
      toolCount: 0
    });
  });

  it("performs a real Streamable HTTP MCP handshake", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        if (request.method !== "POST") {
          response.writeHead(405).end();
          return;
        }
        const message = JSON.parse(body);
        if (message.method === "notifications/initialized") {
          response.writeHead(202).end();
          return;
        }
        const result =
          message.method === "initialize"
            ? {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: {
                  name: "mcpmender-http-test",
                  version: "1.0.0"
                }
              }
            : { tools: [] };
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result })
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind");
      }
      const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-http-"));
      const configPath = path.join(root, "mcp.json");
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            remote: { url: `http://127.0.0.1:${address.port}/mcp` }
          }
        }),
        "utf8"
      );
      const report = await probeMcpConfigurations({
        timeoutMs: 5_000,
        scanOptions: {
          candidates: [
            {
              clientId: "cursor",
              displayName: "Cursor",
              path: configPath,
              format: "jsonc"
            }
          ]
        }
      });
      expect(report.results[0]).toMatchObject({
        status: "connected",
        transport: "http",
        serverNameReported: "mcpmender-http-test",
        toolCount: 0
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
