import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  expandServerVariables,
  loadProbeTargets,
  missingEnvironmentVariables,
  planProbeTargets,
  probeMcpTargets,
  resolveExecutable,
  scanMcpConfigurations,
  type ConfigCandidate,
  type ServerDefinition
} from "./index.js";

const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }
});

function candidate(
  configPath: string,
  clientId: ConfigCandidate["clientId"] = "cursor",
  format: ConfigCandidate["format"] = "jsonc"
): ConfigCandidate {
  return {
    clientId,
    displayName: clientId,
    path: configPath,
    format
  };
}

describe("cross-platform executable and environment handling", () => {
  it.runIf(process.platform === "win32")(
    "finds Windows commands when the environment uses Path instead of PATH",
    async () => {
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      const resolved = await resolveExecutable("cmd", {
        platform: "win32",
        environment: {
          Path: path.win32.join(systemRoot, "System32"),
          PATHEXT: ".EXE;.CMD"
        }
      });
      expect(resolved?.toLowerCase()).toBe(
        path.win32.join(systemRoot, "System32", "cmd.EXE").toLowerCase()
      );
    }
  );

  it("resolves a relative executable from the configured cwd", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-cwd-"));
    const executableName =
      process.platform === "win32" ? "node-link.exe" : "node-link";
    const windowsSystemExecutable =
      process.platform === "win32"
        ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe")
        : process.execPath;
    const sameVolumeExecutable =
      path.parse(process.execPath).root.toLowerCase() ===
      path.parse(root).root.toLowerCase()
        ? process.execPath
        : windowsSystemExecutable;
    await link(sameVolumeExecutable, path.join(root, executableName));
    const resolved = await resolveExecutable(`.${path.sep}${executableName}`, {
      cwd: root
    });
    expect(resolved).toBe(path.join(root, executableName));
  });

  it("reports self-referenced and header-backed variables as missing", () => {
    const server: ServerDefinition = {
      name: "demo",
      command: process.execPath,
      args: [],
      env: {
        MCPMENDER_SELF_REFERENCE: "${MCPMENDER_SELF_REFERENCE}"
      },
      headers: {
        Authorization: "Bearer ${MCPMENDER_HEADER_TOKEN}"
      },
      envKeys: ["MCPMENDER_SELF_REFERENCE"],
      variableSyntax: "generic"
    };
    expect(missingEnvironmentVariables(server, {})).toEqual([
      "MCPMENDER_HEADER_TOKEN",
      "MCPMENDER_SELF_REFERENCE"
    ]);
  });
});

describe("read isolation and client-specific schemas", () => {
  it("accepts a UTF-8 BOM in JSON configuration files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-bom-"));
    const configPath = path.join(root, "mcp.json");
    await writeFile(
      configPath,
      `\uFEFF${JSON.stringify({ mcpServers: { ok: { command: process.execPath } } })}`,
      "utf8"
    );
    const report = await scanMcpConfigurations({
      candidates: [candidate(configPath, "claude-desktop")]
    });
    expect(report.clients[0]).toMatchObject({
      parseable: true,
      serverCount: 1
    });
  });

  it("isolates an unreadable candidate and continues scanning other files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-read-"));
    const directoryCandidate = path.join(root, "directory.json");
    const validConfig = path.join(root, "valid.json");
    await mkdir(directoryCandidate);
    await writeFile(
      validConfig,
      JSON.stringify({
        mcpServers: {
          valid: { command: process.execPath }
        }
      })
    );

    const report = await scanMcpConfigurations({
      candidates: [candidate(directoryCandidate), candidate(validConfig)]
    });
    expect(report.clients).toHaveLength(2);
    expect(report.clients[0]).toMatchObject({
      configFound: true,
      parseable: false
    });
    expect(report.clients[1]).toMatchObject({
      configFound: true,
      parseable: true,
      serverCount: 1
    });
  });

  it("preserves OpenCode command arrays and excludes disabled servers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-opencode-"));
    const configPath = path.join(root, "opencode.jsonc");
    await writeFile(
      configPath,
      JSON.stringify({
        mcp: {
          servers: {
            disabled: {
              type: "local",
              command: ["npx", "-y", "@example/disabled"],
              environment: {
                MCP_API_KEY: "{env:MCP_API_KEY}"
              },
              disabled: true
            },
            active: {
              type: "local",
              command: [process.execPath, "server.mjs"],
              environment: { MODE: "test" }
            }
          }
        }
      })
    );

    const scan = await scanMcpConfigurations({
      platform: "win32",
      candidates: [candidate(configPath, "opencode")],
      includeSensitive: true
    });
    expect(scan.clients[0].servers[0]).toMatchObject({
      name: "disabled",
      command: "npx",
      args: ["-y", "@example/disabled"],
      env: { MCP_API_KEY: "{env:MCP_API_KEY}" },
      enabled: false,
      repairCompatible: false
    });
    expect(scan.repairs).toHaveLength(0);

    const plan = await planProbeTargets({
      platform: "win32",
      candidates: [candidate(configPath, "opencode")]
    });
    expect(plan.map((target) => target.server.name)).toEqual(["active"]);
  });

  it("distinguishes Gemini Streamable HTTP and SSE and understands variables", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-gemini-"));
    const configPath = path.join(root, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcp: {
          allowed: ["streamable", "legacySse", "local"],
          excluded: ["legacySse"]
        },
        mcpServers: {
          streamable: {
            httpUrl: "https://example.test/mcp",
            headers: {
              Authorization: "Bearer $MCPMENDER_GEMINI_TOKEN"
            }
          },
          legacySse: {
            url: "https://example.test/sse"
          },
          local: {
            command: process.execPath,
            args: ["${MCPMENDER_OPTIONAL:-fallback}"],
            env: {
              API_KEY: "$MCPMENDER_GEMINI_TOKEN"
            }
          }
        }
      })
    );

    const report = await scanMcpConfigurations({
      candidates: [candidate(configPath, "gemini")],
      includeSensitive: true
    });
    expect(report.clients[0].servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "streamable",
          transport: "http",
          url: "https://example.test/mcp"
        }),
        expect.objectContaining({
          name: "legacySse",
          transport: "sse",
          url: "https://example.test/sse"
        })
      ])
    );
    expect(
      report.clients[0].servers.find((server) => server.name === "legacySse")
        ?.enabled
    ).toBe(false);
    expect(
      report.clients[0].servers.find((server) => server.name === "local")
        ?.enabled
    ).toBe(true);
    const plan = await planProbeTargets({
      candidates: [candidate(configPath, "gemini")]
    });
    expect(plan.map((target) => target.server.name)).toEqual([
      "streamable",
      "local"
    ]);
    const missingFinding = report.findings.find(
      (finding) => finding.titleKey === "scan.envMissing.title"
    );
    expect(missingFinding?.detailParams?.variables).toContain(
      "MCPMENDER_GEMINI_TOKEN"
    );
    expect(String(missingFinding?.detailParams?.variables)).not.toContain(
      "MCPMENDER_OPTIONAL"
    );
  });

  it("accepts VS Code client-managed inputs and env files without reporting a broken config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-vscode-"));
    const configPath = path.join(root, ".vscode", "mcp.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        servers: {
          blocked: {
            command: process.execPath,
            args: [
              "${workspaceFolder}",
              "${env:MCPMENDER_VSCODE_ENV}",
              "${input:api-key}"
            ],
            envFile: "${workspaceFolder}/.env"
          }
        }
      })
    );
    process.env.MCPMENDER_VSCODE_ENV = "vscode-value";
    try {
      const report = await scanMcpConfigurations({
        candidates: [candidate(configPath, "vscode")],
        includeSensitive: true
      });
      const server = report.clients[0].servers[0];
      expect(server).toMatchObject({
        variableSyntax: "vscode",
        workspaceDir: root
      });
      expect(server.clientManagedVariables).toEqual(
        expect.arrayContaining(["${input:api-key}", "envFile:${workspaceFolder}/.env"])
      );
      expect(report.summary.errors).toBe(0);
      expect(
        expandServerVariables(
          "${workspaceFolder}/${env:MCPMENDER_VSCODE_ENV}",
          "vscode",
          process.env,
          process.platform,
          root
        )
      ).toBe(`${root}/vscode-value`);
      const plan = await planProbeTargets({
        candidates: [candidate(configPath, "vscode")]
      });
      expect(plan).toHaveLength(1);
      const probe = await probeMcpTargets(plan);
      expect(probe.results[0]).toMatchObject({
        status: "unsupported",
        messageKey: "probe.unsupported"
      });
    } finally {
      delete process.env.MCPMENDER_VSCODE_ENV;
    }
  });

  it("retains Codex auth and inherited-env metadata and skips disabled servers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-codex-"));
    const configPath = path.join(root, "config.toml");
    await writeFile(
      configPath,
      `[mcp_servers.disabled]
command = "${process.execPath.replaceAll("\\", "\\\\")}"
enabled = false
env_vars = ["MCPMENDER_CODEX_CUSTOM"]

[mcp_servers.remote]
url = "https://example.test/mcp"
bearer_token_env_var = "MCPMENDER_CODEX_BEARER"
http_headers = { X_Static = "value" }
env_http_headers = { X_Dynamic = "MCPMENDER_CODEX_DYNAMIC" }
`
    );

    const report = await scanMcpConfigurations({
      candidates: [candidate(configPath, "codex", "toml")],
      includeSensitive: true
    });
    expect(report.clients[0].servers[0]).toMatchObject({
      enabled: false,
      inheritEnvKeys: ["MCPMENDER_CODEX_CUSTOM"]
    });
    expect(report.clients[0].servers[1]).toMatchObject({
      transport: "http",
      bearerTokenEnvVar: "MCPMENDER_CODEX_BEARER",
      headers: { X_Static: "value" },
      headerEnv: { X_Dynamic: "MCPMENDER_CODEX_DYNAMIC" }
    });

    const plan = await planProbeTargets({
      candidates: [candidate(configPath, "codex", "toml")]
    });
    expect(plan.map((target) => target.server.name)).toEqual(["remote"]);
  });

  it("uses Codex bearer, static, and environment-backed HTTP headers", async () => {
    const receivedHeaders: Array<Record<string, string | string[] | undefined>> =
      [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        receivedHeaders.push(request.headers);
        if (
          request.headers.authorization !== "Bearer codex-bearer-value" ||
          request.headers.x_static !== "static-value" ||
          request.headers.x_dynamic !== "dynamic-value"
        ) {
          response.writeHead(401).end();
          return;
        }
        if (request.method !== "POST" || !body) {
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
                serverInfo: { name: "codex-auth-test", version: "1.0.0" }
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
    const oldBearer = process.env.MCPMENDER_CODEX_BEARER;
    const oldDynamic = process.env.MCPMENDER_CODEX_DYNAMIC;
    process.env.MCPMENDER_CODEX_BEARER = "codex-bearer-value";
    process.env.MCPMENDER_CODEX_DYNAMIC = "dynamic-value";

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Codex auth test server did not bind");
      }
      const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-codex-http-"));
      const configPath = path.join(root, "config.toml");
      await writeFile(
        configPath,
        `[mcp_servers.remote]
url = "http://127.0.0.1:${address.port}/mcp"
bearer_token_env_var = "MCPMENDER_CODEX_BEARER"
http_headers = { X_Static = "static-value" }
env_http_headers = { X_Dynamic = "MCPMENDER_CODEX_DYNAMIC" }
`
      );
      const snapshot = await loadProbeTargets({
        candidates: [candidate(configPath, "codex", "toml")]
      });
      await writeFile(
        configPath,
        `[mcp_servers.remote]\nurl = "http://127.0.0.1:1/changed-after-preview"\n`
      );
      const report = await probeMcpTargets(snapshot, {
        timeoutMs: 5_000,
        concurrency: 1
      });
      expect(report.results[0]).toMatchObject({
        status: "connected",
        serverNameReported: "codex-auth-test"
      });
      expect(receivedHeaders.length).toBeGreaterThan(0);
    } finally {
      if (oldBearer === undefined) {
        delete process.env.MCPMENDER_CODEX_BEARER;
      } else {
        process.env.MCPMENDER_CODEX_BEARER = oldBearer;
      }
      if (oldDynamic === undefined) {
        delete process.env.MCPMENDER_CODEX_DYNAMIC;
      } else {
        process.env.MCPMENDER_CODEX_DYNAMIC = oldDynamic;
      }
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});

describe("user and project discovery", () => {
  it("discovers VS Code, VSCodium, and profile configs on every platform", async () => {
    // Profile discovery reads real directories. Windows separators cannot be
    // represented as directory boundaries on a POSIX filesystem, so each
    // native CI runner validates its own path rules and the release matrix
    // collectively covers Windows, macOS, and Linux.
    const nativePlatform: "win32" | "darwin" | "linux" =
      process.platform === "win32" || process.platform === "darwin"
        ? process.platform
        : "linux";
    for (const platform of [nativePlatform]) {
      const root = await mkdtemp(
        path.join(os.tmpdir(), `mcpmender-vscode-${platform}-`)
      );
      const platformPath = platform === "win32" ? path.win32 : path.posix;
      const normalizedRoot =
        platform === "win32" ? root : root.replaceAll("\\", "/");
      const home = platformPath.join(normalizedRoot, "home");
      const appData = platformPath.join(normalizedRoot, "appdata");
      const xdg = platformPath.join(home, ".config");
      process.env.XDG_CONFIG_HOME = xdg;
      const stableRoot =
        platform === "darwin"
          ? platformPath.join(
              home,
              "Library",
              "Application Support",
              "Code",
              "User"
            )
          : platform === "win32"
            ? platformPath.join(appData, "Code", "User")
            : platformPath.join(xdg, "Code", "User");
      const insidersRoot =
        platform === "darwin"
          ? platformPath.join(
              home,
              "Library",
              "Application Support",
              "Code - Insiders",
              "User"
            )
          : platform === "win32"
            ? platformPath.join(appData, "Code - Insiders", "User")
            : platformPath.join(xdg, "Code - Insiders", "User");
      const vscodiumRoot =
        platform === "darwin"
          ? platformPath.join(
              home,
              "Library",
              "Application Support",
              "VSCodium",
              "User"
            )
          : platform === "win32"
            ? platformPath.join(appData, "VSCodium", "User")
            : platformPath.join(xdg, "VSCodium", "User");
      const expected = [
        platformPath.join(stableRoot, "mcp.json"),
        platformPath.join(stableRoot, "profiles", "stable-profile", "mcp.json"),
        platformPath.join(insidersRoot, "mcp.json"),
        platformPath.join(
          insidersRoot,
          "profiles",
          "insiders-profile",
          "mcp.json"
        ),
        platformPath.join(vscodiumRoot, "mcp.json")
      ];
      for (const configPath of expected) {
        await mkdir(path.dirname(configPath), { recursive: true });
        await writeFile(
          configPath,
          JSON.stringify({
            servers: configPath.includes(`${platformPath.sep}profiles${platformPath.sep}`)
              ? {
                  profileServer: {
                    type: "stdio",
                    command: process.execPath
                  }
                }
              : {}
          })
        );
      }

      const report = await scanMcpConfigurations({
        platform,
        homeDir: home,
        appDataDir: appData,
        projectDir: platformPath.join(normalizedRoot, "project")
      });
      const found = report.clients
        .filter((client) => client.configFound)
        .map((client) => client.configPath);
      for (const configPath of expected) {
        expect(found.filter((candidatePath) => candidatePath === configPath))
          .toHaveLength(1);
      }
      const profileServers = report.clients
        .filter((client) => client.displayName.includes("(Profile "))
        .flatMap((client) => client.servers);
      expect(profileServers).toHaveLength(2);
      expect(
        profileServers.every((server) =>
          server.probeUnsupportedReason?.includes("active Profile")
        )
      ).toBe(true);
    }
  });

  it("accepts VS Code socket URLs and numeric environment values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-vscode-schema-"));
    const configPath = path.join(root, ".vscode", "mcp.json");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify({
        servers: {
          socket: { type: "http", url: "unix:///tmp/mcp.sock#/mcp" },
          pipe: { type: "http", url: "pipe:///pipe/mcpmender" },
          numeric: {
            type: "stdio",
            command: process.execPath,
            env: { PORT: 3210, REMOVE_ME: null }
          }
        }
      })
    );

    const report = await scanMcpConfigurations({
      candidates: [candidate(configPath, "vscode")],
      includeSensitive: true
    });
    expect(report.summary.errors).toBe(0);
    expect(report.clients[0].servers.find((server) => server.name === "numeric")?.env)
      .toEqual({ PORT: "3210" });
    const targets = await loadProbeTargets({
      candidates: [candidate(configPath, "vscode")]
    });
    const socket = targets.find((target) => target.server.name === "socket");
    expect(socket?.server.probeUnsupportedReason).toContain("unix");
  });

  it("rejects invalid client containers and incompatible OpenCode V2 transports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-invalid-schema-"));
    const invalidContainer = path.join(root, "container.json");
    const invalidTransport = path.join(root, "transport.json");
    await writeFile(invalidContainer, JSON.stringify({ mcpServers: [] }));
    await writeFile(
      invalidTransport,
      JSON.stringify({
        mcp: {
          servers: {
            broken: {
              type: "remote",
              command: [process.execPath, "server.js"]
            }
          }
        }
      })
    );

    for (const configPath of [invalidContainer, invalidTransport]) {
      const report = await scanMcpConfigurations({
        candidates: [candidate(configPath, "opencode")]
      });
      expect(report.summary.errors).toBeGreaterThan(0);
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ titleKey: "scan.schemaInvalid.title" })
        ])
      );
    }
  });

  it("keeps only the effective higher-precedence OpenCode server", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-precedence-"));
    const globalPath = path.join(root, "global.json");
    const projectPath = path.join(root, "project.json");
    await writeFile(
      globalPath,
      JSON.stringify({
        mcp: {
          servers: {
            same: { type: "local", command: [process.execPath, "global.js"] }
          }
        }
      })
    );
    await writeFile(
      projectPath,
      JSON.stringify({
        mcp: {
          servers: {
            same: { type: "local", command: [process.execPath, "project.js"] }
          }
        }
      })
    );

    const targets = await loadProbeTargets({
      candidates: [
        {
          ...candidate(globalPath, "opencode"),
          scope: "user",
          precedence: 10
        },
        {
          ...candidate(projectPath, "opencode"),
          scope: "project",
          precedence: 20
        }
      ]
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].server.args).toEqual(["project.js"]);
  });

  it("discovers supported user and project configuration scopes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-scopes-"));
    const home = path.join(root, "home");
    const appData = path.join(root, "appdata");
    const project = path.join(root, "project");
    const xdg = path.join(home, ".config");
    process.env.XDG_CONFIG_HOME = xdg;

    const vscodeUser =
      process.platform === "darwin"
        ? path.join(
            home,
            "Library",
            "Application Support",
            "Code",
            "User",
            "mcp.json"
          )
        : process.platform === "win32"
          ? path.join(appData, "Code", "User", "mcp.json")
          : path.join(xdg, "Code", "User", "mcp.json");
    const paths = [
      vscodeUser,
      path.join(project, ".codex", "config.toml"),
      path.join(project, ".cursor", "mcp.json"),
      path.join(project, ".gemini", "settings.json"),
      path.join(xdg, "opencode", "opencode.jsonc"),
      path.join(project, "opencode.jsonc")
    ];
    for (const configPath of paths) {
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(
        configPath,
        configPath.endsWith(".toml")
          ? `[mcp_servers.demo]\ncommand = "${process.execPath.replaceAll("\\", "\\\\")}"\n`
          : JSON.stringify({
              mcpServers: { demo: { command: process.execPath } }
            })
      );
    }

    const report = await scanMcpConfigurations({
      homeDir: home,
      appDataDir: appData,
      projectDir: project
    });
    const foundPaths = report.clients
      .filter((client) => client.configFound)
      .map((client) => client.configPath);
    for (const configPath of paths) {
      expect(foundPaths).toContain(configPath);
    }

    expect(await readFile(paths[0], "utf8")).toContain("mcpServers");
  });
});
