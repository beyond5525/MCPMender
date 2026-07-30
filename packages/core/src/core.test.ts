import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import {
  applySafeRepairs,
  normalizeLocale,
  planProbeTargets,
  probeMcpTargets,
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

  it("keeps finding and repair IDs unique for same-named servers in different configs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-id-scope-"));
    const configPaths = [
      path.join(root, "private-user-config.json"),
      path.join(root, "private-project-config.json")
    ];
    for (const configPath of configPaths) {
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            demo: {
              command: "npx",
              args: ["-y", "@example/mcp"]
            }
          }
        }),
        "utf8"
      );
    }
    const candidates: ConfigCandidate[] = configPaths.map((configPath) => ({
      clientId: "cursor",
      displayName: "Cursor",
      path: configPath,
      format: "jsonc"
    }));

    const first = await scanMcpConfigurations({
      platform: "win32",
      candidates
    });
    const second = await scanMcpConfigurations({
      platform: "win32",
      candidates
    });
    const repairIds = first.repairs.map((repair) => repair.id);
    const findingIds = first.findings.map((finding) => finding.id);

    expect(repairIds).toHaveLength(2);
    expect(new Set(repairIds).size).toBe(repairIds.length);
    expect(new Set(findingIds).size).toBe(findingIds.length);
    expect(repairIds).toEqual(second.repairs.map((repair) => repair.id));
    expect(findingIds).toEqual(second.findings.map((finding) => finding.id));
    expect(repairIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^cursor:demo:wrap-npx:[a-f0-9]{12}$/)
      ])
    );
    for (const id of [...repairIds, ...findingIds]) {
      expect(id).not.toContain(root);
      expect(id).not.toContain("private-user-config");
      expect(id).not.toContain("private-project-config");
    }

    const result = await applySafeRepairs(first.repairs, {
      backupRoot: path.join(root, "backups")
    });
    expect(result.results).toHaveLength(2);
    expect(result.results.every((item) => item.applied)).toBe(true);
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
      result: message.params?.cursor
        ? { tools: [{ name: "second", description: "second", inputSchema: { type: "object" } }] }
        : {
            tools: [{ name: "first", description: "first", inputSchema: { type: "object" } }],
            nextCursor: "page-2"
          }
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
      toolCount: 2
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

  it("falls back from VS Code HTTP to SSE while preserving headers and cleaning up", async () => {
    const requests: Array<{ method?: string; path?: string; auth?: string }> = [];
    let sseTransport: SSEServerTransport | undefined;
    let mcpServer: Server | undefined;
    let sseResponseClosed = false;
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      requests.push({
        method: request.method,
        path: requestUrl.pathname,
        auth:
          typeof request.headers["x-test-auth"] === "string"
            ? request.headers["x-test-auth"]
            : undefined
      });
      if (requestUrl.pathname === "/mcp" && request.method === "POST") {
        response.writeHead(405).end("Method Not Allowed");
        return;
      }
      if (requestUrl.pathname === "/mcp" && request.method === "GET") {
        response.once("close", () => {
          sseResponseClosed = true;
        });
        sseTransport = new SSEServerTransport("/messages", response);
        mcpServer = new Server(
          { name: "mcpmender-sse-fallback", version: "1.0.0" },
          { capabilities: { tools: {} } }
        );
        mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: []
        }));
        await mcpServer.connect(sseTransport);
        return;
      }
      if (
        requestUrl.pathname === "/messages" &&
        request.method === "POST" &&
        sseTransport
      ) {
        await sseTransport.handlePostMessage(request, response);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("SSE fallback test server did not bind");
      }
      const report = await probeMcpTargets(
        [
          {
            clientId: "vscode",
            clientName: "VS Code",
            configPath: "mcp.json",
            server: {
              name: "fallback",
              args: [],
              url: `http://127.0.0.1:${address.port}/mcp`,
              transport: "http",
              headers: { "X-Test-Auth": "preserved-secret" }
            }
          }
        ],
        { timeoutMs: 4_000 }
      );
      expect(report.results[0]).toMatchObject({
        status: "connected",
        serverNameReported: "mcpmender-sse-fallback",
        toolCount: 0
      });
      expect(requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "POST", path: "/mcp" }),
          expect.objectContaining({ method: "GET", path: "/mcp" }),
          expect.objectContaining({ method: "POST", path: "/messages" })
        ])
      );
      expect(requests.every((request) => request.auth === "preserved-secret"))
        .toBe(true);
      for (
        let attempt = 0;
        attempt < 20 && !sseResponseClosed;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(sseResponseClosed).toBe(true);
    } finally {
      await mcpServer?.close().catch(() => undefined);
      await sseTransport?.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("classifies HTTP 403 responses as authentication-required", async () => {
    let getRequests = 0;
    const server = createServer((_request, response) => {
      if (_request.method === "GET") getRequests += 1;
      response.writeHead(403).end("Forbidden");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("HTTP test server did not bind");
      }
      const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-403-"));
      const configPath = path.join(root, "mcp.json");
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            protected: { url: `http://127.0.0.1:${address.port}/mcp` }
          }
        })
      );
      const report = await probeMcpConfigurations({
        timeoutMs: 2_000,
        scanOptions: {
          candidates: [
            {
              clientId: "vscode",
              displayName: "VS Code",
              path: configPath,
              format: "jsonc"
            }
          ]
        }
      });
      expect(report.results[0].status).toBe("auth-required");
      expect(getRequests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("uses an external AbortSignal and terminates an active stdio process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-abort-"));
    const serverPath = path.join(root, "hanging-server.mjs");
    const pidPath = path.join(root, "server.pid");
    await writeFile(
      serverPath,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.stdin.resume();
`,
      "utf8"
    );
    const controller = new AbortController();
    const startedAt = Date.now();
    const probe = probeMcpTargets(
      [
        {
          clientId: "cursor",
          clientName: "Cursor",
          configPath: "mcp.json",
          server: {
            name: "hanging",
            command: process.execPath,
            args: [serverPath],
            transport: "stdio"
          }
        }
      ],
      { timeoutMs: 5_000, signal: controller.signal }
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    const report = await probe;
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(report.results[0].status).toBe("timeout");

    const pid = Number(await readFile(pidPath, "utf8"));
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt += 1) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  });
});
