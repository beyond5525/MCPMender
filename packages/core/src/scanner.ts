import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import {
  missingEnvironmentVariables,
  resolveExecutable
} from "./environment.js";
import type {
  ClientScanResult,
  ConfigCandidate,
  Finding,
  RepairAction,
  ScanOptions,
  ScanReport,
  ServerDefinition
} from "./types.js";

function defaultCandidates(options: ScanOptions): ConfigCandidate[] {
  const home = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const appData =
    options.appDataDir ??
    (platform === "win32"
      ? process.env.APPDATA ??
        platformPath.join(home, "AppData", "Roaming")
      : "");
  const xdgConfig =
    process.env.XDG_CONFIG_HOME ?? platformPath.join(home, ".config");
  const project = options.projectDir ?? process.cwd();
  const claudePath =
    platform === "win32"
      ? platformPath.join(
          appData,
          "Claude",
          "claude_desktop_config.json"
        )
      : platform === "darwin"
        ? platformPath.join(
            home,
            "Library",
            "Application Support",
            "Claude",
            "claude_desktop_config.json"
          )
        : platformPath.join(
            xdgConfig,
            "Claude",
            "claude_desktop_config.json"
          );

  const candidates: ConfigCandidate[] = [
    {
      clientId: "codex",
      displayName: "Codex",
      path: platformPath.join(home, ".codex", "config.toml"),
      format: "toml"
    },
    {
      clientId: "claude-desktop",
      displayName: "Claude Desktop",
      path: claudePath,
      format: "jsonc"
    },
    {
      clientId: "cursor",
      displayName: "Cursor",
      path: platformPath.join(home, ".cursor", "mcp.json"),
      format: "jsonc"
    },
    {
      clientId: "vscode",
      displayName: "VS Code",
      path: platformPath.join(project, ".vscode", "mcp.json"),
      format: "jsonc"
    },
    {
      clientId: "gemini",
      displayName: "Gemini CLI",
      path: platformPath.join(home, ".gemini", "settings.json"),
      format: "jsonc"
    },
    {
      clientId: "opencode",
      displayName: "OpenCode",
      path:
        platform === "win32"
          ? platformPath.join(appData, "opencode", "opencode.json")
          : platformPath.join(xdgConfig, "opencode", "opencode.json"),
      format: "jsonc"
    }
  ];
  return options.skipProjectConfigs
    ? candidates.filter((candidate) => candidate.clientId !== "vscode")
    : candidates;
}
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeArgs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
}

function stringRecord(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractServers(parsed: Record<string, unknown>): ServerDefinition[] {
  const raw =
    parsed.mcpServers ??
    parsed.mcp_servers ??
    (parsed.mcp as Record<string, unknown> | undefined)?.servers ??
    parsed.servers;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
    const definition =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const commandArray = Array.isArray(definition.command)
      ? normalizeArgs(definition.command)
      : [];
    return {
      name,
      command:
        typeof definition.command === "string"
          ? definition.command
          : commandArray[0],
      args:
        commandArray.length > 0
          ? commandArray.slice(1)
          : normalizeArgs(definition.args),
      url:
        typeof definition.url === "string"
          ? definition.url
          : typeof definition.http_url === "string"
            ? definition.http_url
            : undefined,
      cwd:
        typeof definition.cwd === "string" ? definition.cwd : undefined,
      env: stringRecord(definition.env),
      envKeys: Object.keys(stringRecord(definition.env) ?? {}),
      headers: stringRecord(definition.headers),
      hasHeaders:
        definition.headers !== undefined &&
        typeof definition.headers === "object"
    };
  });
}

function makeFinding(
  candidate: ConfigCandidate,
  partial: Omit<Finding, "clientId" | "clientName" | "configPath">
): Finding {
  return {
    clientId: candidate.clientId,
    clientName: candidate.displayName,
    configPath: candidate.path,
    ...partial
  };
}

export async function scanMcpConfigurations(
  options: ScanOptions = {}
): Promise<ScanReport> {
  const platform = options.platform ?? process.platform;
  const candidates = options.candidates ?? defaultCandidates(options);
  const clients: ClientScanResult[] = [];
  const allRepairs: RepairAction[] = [];

  for (const candidate of candidates) {
    const found = await fileExists(candidate.path);
    const findings: Finding[] = [];
    const base: ClientScanResult = {
      clientId: candidate.clientId,
      displayName: candidate.displayName,
      configPath: candidate.path,
      installed: found,
      configFound: found,
      parseable: true,
      serverCount: 0,
      servers: [],
      findings
    };

    if (!found) {
      findings.push(
        makeFinding(candidate, {
          id: `${candidate.clientId}:config-missing`,
          severity: "info",
          titleKey: "scan.configMissing.title",
          detailKey: "scan.configMissing.detail",
          detailParams: { path: candidate.path }
        })
      );
      clients.push(base);
      continue;
    }

    const content = await readFile(candidate.path, "utf8");
    let parsed: Record<string, unknown>;

    try {
      if (candidate.format === "toml") {
        parsed = parseToml(content) as Record<string, unknown>;
      } else {
        const errors: ParseError[] = [];
        parsed = parseJsonc(content, errors, {
          allowTrailingComma: true,
          disallowComments: false
        }) as Record<string, unknown>;
        if (errors.length > 0 || !parsed) throw new Error("Invalid JSONC");
      }
    } catch {
      base.parseable = false;
      findings.push(
        makeFinding(candidate, {
          id: `${candidate.clientId}:parse-error`,
          severity: "error",
          titleKey: "scan.parseError.title",
          detailKey: "scan.parseError.detail"
        })
      );
      clients.push(base);
      continue;
    }

    const servers = extractServers(parsed);
    base.servers = servers.map((server) =>
      options.includeSensitive
        ? server
        : { ...server, env: undefined, headers: undefined }
    );
    base.serverCount = servers.length;

    for (const server of servers) {
      if (!server.command && !server.url) {
        findings.push(
          makeFinding(candidate, {
            id: `${candidate.clientId}:${server.name}:invalid`,
            serverName: server.name,
            severity: "error",
            titleKey: "scan.serverInvalid.title",
            detailKey: "scan.serverInvalid.detail",
            detailParams: { server: server.name }
          })
        );
      }

      if (server.command) {
        const commandEnvironment = {
          ...process.env,
          ...(server.env ?? {})
        };
        const resolved = await resolveExecutable(server.command, {
          platform,
          environment: commandEnvironment
        });
        if (!resolved) {
          findings.push(
            makeFinding(candidate, {
              id: `${candidate.clientId}:${server.name}:command-missing`,
              serverName: server.name,
              severity: "error",
              titleKey: "scan.commandMissing.title",
              detailKey: "scan.commandMissing.detail",
              detailParams: {
                server: server.name,
                command: server.command
              }
            })
          );
        }
      }

      const missingVariables = missingEnvironmentVariables(server);
      if (missingVariables.length > 0) {
        findings.push(
          makeFinding(candidate, {
            id: `${candidate.clientId}:${server.name}:env-missing`,
            serverName: server.name,
            severity: "error",
            titleKey: "scan.envMissing.title",
            detailKey: "scan.envMissing.detail",
            detailParams: {
              server: server.name,
              variables: missingVariables.join(", ")
            }
          })
        );
      }

      if (server.url) {
        try {
          const parsedUrl = new URL(server.url);
          if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            throw new Error("Unsupported protocol");
          }
        } catch {
          findings.push(
            makeFinding(candidate, {
              id: `${candidate.clientId}:${server.name}:url-invalid`,
              serverName: server.name,
              severity: "error",
              titleKey: "scan.urlInvalid.title",
              detailKey: "scan.urlInvalid.detail",
              detailParams: { server: server.name }
            })
          );
        }
      }

      if (
        platform === "win32" &&
        candidate.format === "jsonc" &&
        server.command?.toLowerCase() === "npx"
      ) {
        const repairId = `${candidate.clientId}:${server.name}:wrap-npx`;
        findings.push(
          makeFinding(candidate, {
            id: `${candidate.clientId}:${server.name}:windows-npx`,
            serverName: server.name,
            severity: "warning",
            titleKey: "scan.windowsNpx.title",
            detailKey: "scan.windowsNpx.detail",
            detailParams: { server: server.name },
            repairId
          })
        );
        allRepairs.push({
          id: repairId,
          clientId: candidate.clientId,
          clientName: candidate.displayName,
          configPath: candidate.path,
          serverName: server.name,
          risk: "safe",
          kind: "wrap-windows-npx",
          titleKey: "repair.windowsNpx.title",
          detailKey: "repair.windowsNpx.detail",
          before: { command: "npx", args: server.args },
          after: {
            command: "cmd",
            args: ["/d", "/s", "/c", "npx", ...server.args]
          },
          expectedHash: hashText(content)
        });
      }
    }

    if (findings.length === 0) {
      findings.push(
        makeFinding(candidate, {
          id: `${candidate.clientId}:ok`,
          severity: "info",
          titleKey: "scan.ok.title",
          detailKey: "scan.ok.detail"
        })
      );
    }

    clients.push(base);
  }

  const findings = clients.flatMap((client) => client.findings);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform,
    clients,
    findings,
    repairs: allRepairs,
    summary: {
      detectedClients: clients.filter((client) => client.configFound).length,
      configuredServers: clients.reduce(
        (total, client) => total + client.serverCount,
        0
      ),
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter(
        (finding) => finding.severity === "warning"
      ).length,
      safeRepairs: allRepairs.filter((repair) => repair.risk === "safe").length
    }
  };
}
