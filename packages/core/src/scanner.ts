import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import {
  expandServerVariables,
  missingEnvironmentVariables,
  resolveServerEnvironment,
  resolveExecutable
} from "./environment.js";
import { isSafeWindowsCommandArgument } from "./repairs.js";
import type {
  ClientScanResult,
  ConfigCandidate,
  Finding,
  RepairAction,
  ScanOptions,
  ScanReport,
  ServerDefinition
} from "./types.js";

async function defaultCandidates(
  options: ScanOptions
): Promise<ConfigCandidate[]> {
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
  const vscodeUserRoot =
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
        : platformPath.join(xdgConfig, "Code", "User");
  const vscodeInsidersUserRoot =
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
        : platformPath.join(xdgConfig, "Code - Insiders", "User");
  const vscodiumUserRoot =
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
        : platformPath.join(xdgConfig, "VSCodium", "User");
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
      format: "toml",
      scope: "user",
      precedence: 10
    },
    {
      clientId: "claude-desktop",
      displayName: "Claude Desktop",
      path: claudePath,
      format: "jsonc",
      scope: "user",
      precedence: 10
    },
    {
      clientId: "cursor",
      displayName: "Cursor",
      path: platformPath.join(home, ".cursor", "mcp.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10
    },
    {
      clientId: "vscode",
      displayName: "VS Code",
      path: platformPath.join(project, ".vscode", "mcp.json"),
      format: "jsonc",
      scope: "project",
      precedence: 20,
      workspaceDir: project
    },
    {
      clientId: "gemini",
      displayName: "Gemini CLI",
      path: platformPath.join(home, ".gemini", "settings.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10
    },
    {
      clientId: "opencode",
      displayName: "OpenCode",
      path: platformPath.join(xdgConfig, "opencode", "opencode.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10,
      workspaceDir: project
    }
  ];

  const optionalCandidates: ConfigCandidate[] = [
    {
      clientId: "vscode",
      displayName: "VS Code (User)",
      path: platformPath.join(vscodeUserRoot, "mcp.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10,
      workspaceDir: project
    },
    {
      clientId: "vscode",
      displayName: "VS Code Insiders (User)",
      path: platformPath.join(vscodeInsidersUserRoot, "mcp.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10,
      workspaceDir: project
    },
    {
      clientId: "vscode",
      displayName: "VSCodium (User)",
      path: platformPath.join(vscodiumUserRoot, "mcp.json"),
      format: "jsonc",
      scope: "user",
      precedence: 10,
      workspaceDir: project
    },
    {
      clientId: "opencode",
      displayName: "OpenCode (JSONC)",
      path: platformPath.join(xdgConfig, "opencode", "opencode.jsonc"),
      format: "jsonc",
      scope: "user",
      precedence: 11,
      workspaceDir: project
    }
  ];
  for (const [root, label] of [
    [vscodeUserRoot, "VS Code"],
    [vscodeInsidersUserRoot, "VS Code Insiders"]
  ] as const) {
    const profilesRoot = platformPath.join(root, "profiles");
    let profiles: Dirent[] = [];
    try {
      profiles = await readdir(profilesRoot, { withFileTypes: true });
    } catch {
      // Profiles are optional.
    }
    for (const profile of profiles) {
      if (!profile.isDirectory()) continue;
      optionalCandidates.push({
        clientId: "vscode",
        displayName: `${label} (Profile ${profile.name})`,
        path: platformPath.join(profilesRoot, profile.name, "mcp.json"),
        format: "jsonc",
        scope: "user",
        precedence: 10,
        workspaceDir: project,
        probeUnsupportedReason:
          "VS Code does not expose the active Profile reliably; test this server from the active VS Code Profile."
      });
    }
  }
  if (platform === "win32") {
    optionalCandidates.push({
      clientId: "opencode",
      displayName: "OpenCode (Legacy)",
      path: platformPath.join(appData, "opencode", "opencode.json"),
      format: "jsonc",
      scope: "user",
      precedence: 9,
      workspaceDir: project
    });
  }

  if (!options.skipProjectConfigs) {
    optionalCandidates.push(
      {
        clientId: "codex",
        displayName: "Codex (Project)",
        path: platformPath.join(project, ".codex", "config.toml"),
        format: "toml",
        scope: "project",
        precedence: 20
      },
      {
        clientId: "cursor",
        displayName: "Cursor (Project)",
        path: platformPath.join(project, ".cursor", "mcp.json"),
        format: "jsonc",
        scope: "project",
        precedence: 20,
        workspaceDir: project
      },
      {
        clientId: "gemini",
        displayName: "Gemini CLI (Project)",
        path: platformPath.join(project, ".gemini", "settings.json"),
        format: "jsonc",
        scope: "project",
        precedence: 20,
        workspaceDir: project
      },
      {
        clientId: "opencode",
        displayName: "OpenCode (Project)",
        path: platformPath.join(project, "opencode.json"),
        format: "jsonc",
        scope: "project",
        precedence: 20,
        workspaceDir: project
      },
      {
        clientId: "opencode",
        displayName: "OpenCode (Project JSONC)",
        path: platformPath.join(project, "opencode.jsonc"),
        format: "jsonc",
        scope: "project",
        precedence: 21,
        workspaceDir: project
      },
      {
        clientId: "opencode",
        displayName: "OpenCode (.opencode Project)",
        path: platformPath.join(project, ".opencode", "opencode.json"),
        format: "jsonc",
        scope: "project",
        precedence: 22,
        workspaceDir: project
      },
      {
        clientId: "opencode",
        displayName: "OpenCode (.opencode Project JSONC)",
        path: platformPath.join(project, ".opencode", "opencode.jsonc"),
        format: "jsonc",
        scope: "project",
        precedence: 23,
        workspaceDir: project
      }
    );
  }

  const primaryCandidates = options.skipProjectConfigs
    ? candidates.filter((candidate) => candidate.clientId !== "vscode")
    : candidates;
  const existingOptional = (
    await Promise.all(
      optionalCandidates.map(async (candidate) => ({
        candidate,
        exists: await fileExists(candidate.path)
      }))
    )
  )
    .filter((entry) => entry.exists)
    .map((entry) => entry.candidate);
  const seen = new Set<string>();
  return [...primaryCandidates, ...existingOptional].filter((candidate) => {
    const candidatePath =
      platform === "win32" ? candidate.path.toLowerCase() : candidate.path;
    const key = `${candidate.clientId}:${candidatePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function configPathDigest(
  configPath: string,
  platform: NodeJS.Platform
): string {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const resolved = platformPath.resolve(configPath);
  const canonical = platform === "win32" ? resolved.toLowerCase() : resolved;
  return hashText(canonical).slice(0, 12);
}

function normalizeArgs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === "string");
}

function stringRecord(
  input: unknown,
  options: { coerceNumbers?: boolean } = {}
): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[key, value] as [string, string]]
      : options.coerceNumbers && typeof value === "number" && Number.isFinite(value)
        ? [[key, String(value)] as [string, string]]
        : []
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.key === "string"
          ? record.key
          : undefined;
    return name ? [name] : [];
  });
}

interface SchemaIssue {
  serverName?: string;
}

function rawServerContainer(
  parsed: Record<string, unknown>,
  candidate: ConfigCandidate
): unknown {
  const mcp =
    parsed.mcp && typeof parsed.mcp === "object" && !Array.isArray(parsed.mcp)
      ? (parsed.mcp as Record<string, unknown>)
      : undefined;
  return (
    parsed.mcpServers ??
    parsed.mcp_servers ??
    mcp?.servers ??
    (candidate.clientId === "opencode" ? mcp : undefined) ??
    parsed.servers
  );
}

function validateClientSchema(
  parsed: Record<string, unknown>,
  candidate: ConfigCandidate
): SchemaIssue[] {
  const raw = rawServerContainer(parsed, candidate);
  if (raw === undefined) return [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{}];

  const issues: SchemaIssue[] = [];
  const openCodeV2 =
    candidate.clientId === "opencode" &&
    parsed.mcp !== null &&
    typeof parsed.mcp === "object" &&
    !Array.isArray(parsed.mcp) &&
    (parsed.mcp as Record<string, unknown>).servers === raw;

  for (const [serverName, value] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push({ serverName });
      continue;
    }
    const definition = value as Record<string, unknown>;
    const type =
      typeof definition.type === "string"
        ? definition.type.toLowerCase()
        : undefined;
    const hasCommand =
      typeof definition.command === "string" ||
      (Array.isArray(definition.command) &&
        typeof definition.command[0] === "string" &&
        definition.command[0].length > 0);
    const hasUrl =
      typeof definition.url === "string" ||
      typeof definition.httpUrl === "string" ||
      typeof definition.http_url === "string";

    if (openCodeV2) {
      if (
        (type !== "local" && type !== "remote") ||
        (type === "local" &&
          (!Array.isArray(definition.command) || !hasCommand || hasUrl)) ||
        (type === "remote" && (!hasUrl || hasCommand))
      ) {
        issues.push({ serverName });
      }
      continue;
    }

    if (candidate.clientId === "vscode" && type) {
      if (
        !["stdio", "http", "sse"].includes(type) ||
        (type === "stdio" && (!hasCommand || hasUrl)) ||
        ((type === "http" || type === "sse") && (!hasUrl || hasCommand))
      ) {
        issues.push({ serverName });
      }
    }
  }
  return issues;
}

function extractServers(
  parsed: Record<string, unknown>,
  candidate: ConfigCandidate
): ServerDefinition[] {
  const mcp = parsed.mcp as Record<string, unknown> | undefined;
  const geminiAllowed =
    candidate.clientId === "gemini" && Array.isArray(mcp?.allowed)
      ? normalizeArgs(mcp.allowed)
      : undefined;
  const geminiExcluded =
    candidate.clientId === "gemini" && Array.isArray(mcp?.excluded)
      ? normalizeArgs(mcp.excluded)
      : [];
  const raw = rawServerContainer(parsed, candidate);

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
    const definition =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const commandArray = Array.isArray(definition.command)
      ? normalizeArgs(definition.command)
      : [];
    const explicitEnvironment =
      candidate.clientId === "opencode"
        ? stringRecord(definition.environment) ?? stringRecord(definition.env)
        : stringRecord(definition.env, {
            coerceNumbers: candidate.clientId === "vscode"
          });
    const inheritEnvKeys =
      candidate.clientId === "codex" ? stringList(definition.env_vars) : [];
    const headerEnv =
      candidate.clientId === "codex"
        ? stringRecord(definition.env_http_headers)
        : undefined;
    const bearerTokenEnvVar =
      candidate.clientId === "codex" &&
      typeof definition.bearer_token_env_var === "string"
        ? definition.bearer_token_env_var
        : undefined;
    const headers =
      stringRecord(definition.headers) ??
      (candidate.clientId === "codex"
        ? stringRecord(definition.http_headers)
        : undefined);
    const httpUrl =
      typeof definition.httpUrl === "string"
        ? definition.httpUrl
        : typeof definition.http_url === "string"
          ? definition.http_url
          : undefined;
    const standardUrl =
      typeof definition.url === "string" ? definition.url : undefined;
    const definitionType =
      typeof definition.type === "string"
        ? definition.type.toLowerCase()
        : undefined;
    const transport =
      candidate.clientId === "gemini"
        ? httpUrl
          ? "http"
          : standardUrl
            ? "sse"
            : commandArray.length > 0 ||
                typeof definition.command === "string"
              ? "stdio"
              : undefined
        : definitionType === "sse"
          ? "sse"
          : definitionType === "http" ||
              definitionType === "remote" ||
              standardUrl ||
              httpUrl
            ? "http"
            : commandArray.length > 0 ||
                typeof definition.command === "string"
              ? "stdio"
              : undefined;
    const enabled =
      definition.enabled === false ||
      definition.disabled === true ||
      geminiExcluded.includes(name) ||
      (geminiAllowed !== undefined && !geminiAllowed.includes(name))
        ? false
        : true;
    const variableSyntax: NonNullable<
      ServerDefinition["variableSyntax"]
    > =
      candidate.clientId === "gemini"
        ? "gemini"
        : candidate.clientId === "opencode"
          ? "opencode"
          : candidate.clientId === "vscode"
            ? "vscode"
            : "generic";
    const candidateParent = path.dirname(candidate.path);
    const workspaceDir =
      candidate.workspaceDir ??
      (candidate.clientId === "vscode" &&
      path.basename(candidateParent).toLowerCase() === ".vscode"
        ? path.dirname(candidateParent)
        : undefined);
    const variableValues = [
      ...(typeof definition.command === "string"
        ? [definition.command]
        : commandArray),
      ...normalizeArgs(definition.args),
      httpUrl,
      standardUrl,
      typeof definition.cwd === "string" ? definition.cwd : undefined,
      ...Object.values(explicitEnvironment ?? {}),
      ...Object.values(headers ?? {})
    ].filter((entry): entry is string => typeof entry === "string");
    const clientManagedVariables =
      candidate.clientId === "vscode"
        ? [
            ...new Set([
              ...variableValues.flatMap((entry) =>
                [...entry.matchAll(/\$\{input:([^}]+)\}/g)].map(
                  (match) => `\${input:${match[1]}}`
                )
              ),
              ...variableValues.flatMap((entry) =>
                [...entry.matchAll(/\$\{workspaceFolder:([^}]+)\}/g)].map(
                  (match) => `\${workspaceFolder:${match[1]}}`
                )
              ),
              ...(!workspaceDir &&
              variableValues.some((entry) =>
                entry.includes("${workspaceFolder}")
              )
                ? ["${workspaceFolder}"]
                : []),
              ...(typeof definition.envFile === "string"
                ? [`envFile:${definition.envFile}`]
                : [])
            ])
          ]
        : [];
    const unsupportedUrl =
      candidate.clientId === "vscode" &&
      typeof standardUrl === "string" &&
      /^(?:unix|pipe):\/\//i.test(standardUrl)
        ? standardUrl.split(":", 1)[0].toLowerCase()
        : undefined;
    const envKeys = [
      ...Object.keys(explicitEnvironment ?? {}),
      ...inheritEnvKeys,
      ...Object.values(headerEnv ?? {}),
      ...(bearerTokenEnvVar ? [bearerTokenEnvVar] : [])
    ];
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
      url: httpUrl ?? standardUrl,
      cwd:
        typeof definition.cwd === "string" ? definition.cwd : undefined,
      env: explicitEnvironment,
      envKeys: [...new Set(envKeys)],
      headers,
      headerEnv,
      bearerTokenEnvVar,
      inheritEnvKeys,
      hasHeaders:
        Boolean(headers) || Boolean(headerEnv) || Boolean(bearerTokenEnvVar),
      enabled,
      transport,
      variableSyntax,
      workspaceDir,
      unresolvedVariables: [],
      clientManagedVariables,
      probeUnsupportedReason:
        clientManagedVariables.length > 0
          ? `Client-managed values require VS Code: ${clientManagedVariables.join(", ")}`
          : unsupportedUrl
            ? `${unsupportedUrl} socket transports must be tested by VS Code.`
            : candidate.probeUnsupportedReason,
      repairCompatible: candidate.clientId !== "opencode"
    };
  });
}

function makeFinding(
  candidate: ConfigCandidate,
  partial: Omit<Finding, "clientId" | "clientName" | "configPath">,
  configScope: string
): Finding {
  return {
    clientId: candidate.clientId,
    clientName: candidate.displayName,
    configPath: candidate.path,
    ...partial,
    id: `${partial.id}:${configScope}`
  };
}

export async function scanMcpConfigurations(
  options: ScanOptions = {}
): Promise<ScanReport> {
  const platform = options.platform ?? process.platform;
  const candidates = options.candidates ?? (await defaultCandidates(options));
  const clients: ClientScanResult[] = [];
  const allRepairs: RepairAction[] = [];

  for (const candidate of candidates) {
    const configScope = configPathDigest(candidate.path, platform);
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
      findings,
      scope: candidate.scope,
      precedence: candidate.precedence
    };

    if (!found) {
      findings.push(
        makeFinding(
          candidate,
          {
            id: `${candidate.clientId}:config-missing`,
            severity: "info",
            titleKey: "scan.configMissing.title",
            detailKey: "scan.configMissing.detail",
            detailParams: { path: candidate.path }
          },
          configScope
        )
      );
      clients.push(base);
      continue;
    }

    let rawContent: string;
    let content: string;
    try {
      rawContent = await readFile(candidate.path, "utf8");
      content = rawContent.replace(/^\uFEFF/, "");
    } catch {
      base.parseable = false;
      findings.push(
        makeFinding(
          candidate,
          {
            id: `${candidate.clientId}:read-error`,
            severity: "error",
            titleKey: "scan.parseError.title",
            detailKey: "scan.parseError.detail"
          },
          configScope
        )
      );
      clients.push(base);
      continue;
    }
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
        makeFinding(
          candidate,
          {
            id: `${candidate.clientId}:parse-error`,
            severity: "error",
            titleKey: "scan.parseError.title",
            detailKey: "scan.parseError.detail"
          },
          configScope
        )
      );
      clients.push(base);
      continue;
    }

    const schemaIssues = validateClientSchema(parsed, candidate);
    for (const issue of schemaIssues) {
      findings.push(
        makeFinding(
          candidate,
          {
            id: `${candidate.clientId}:${issue.serverName ?? "configuration"}:schema-invalid`,
            serverName: issue.serverName,
            severity: "error",
            titleKey: "scan.schemaInvalid.title",
            detailKey: "scan.schemaInvalid.detail",
            detailParams: {
              server: issue.serverName ?? candidate.displayName
            }
          },
          configScope
        )
      );
    }
    const invalidServerNames = new Set(
      schemaIssues.flatMap((issue) => issue.serverName ?? [])
    );
    const servers = extractServers(parsed, candidate);
    base.servers = servers.map((server) =>
      options.includeSensitive
        ? server
        : {
            ...server,
            env: undefined,
            headers: undefined
          }
    );
    base.serverCount = servers.length;

    for (const server of servers) {
      if (server.enabled === false) continue;
      if (invalidServerNames.has(server.name)) continue;

      if ((server.unresolvedVariables?.length ?? 0) > 0) {
        findings.push(
          makeFinding(
            candidate,
            {
              id: `${candidate.clientId}:${server.name}:variable-unresolved`,
              serverName: server.name,
              severity: "error",
              titleKey: "scan.envMissing.title",
              detailKey: "scan.envMissing.detail",
              detailParams: {
                server: server.name,
                variables: server.unresolvedVariables!.join(", ")
              }
            },
            configScope
          )
        );
        continue;
      }

      if (!server.command && !server.url) {
        findings.push(
          makeFinding(
            candidate,
            {
              id: `${candidate.clientId}:${server.name}:invalid`,
              serverName: server.name,
              severity: "error",
              titleKey: "scan.serverInvalid.title",
              detailKey: "scan.serverInvalid.detail",
              detailParams: { server: server.name }
            },
            configScope
          )
        );
      }

      if (server.command) {
        const commandEnvironment = resolveServerEnvironment(
          server,
          process.env,
          platform
        );
        const resolved = await resolveExecutable(server.command, {
          platform,
          environment: commandEnvironment,
          cwd: server.cwd,
          variableSyntax: server.variableSyntax,
          workspaceDir: server.workspaceDir
        });
        if (!resolved) {
          findings.push(
            makeFinding(
              candidate,
              {
                id: `${candidate.clientId}:${server.name}:command-missing`,
                serverName: server.name,
                severity: "error",
                titleKey: "scan.commandMissing.title",
                detailKey: "scan.commandMissing.detail",
                detailParams: {
                  server: server.name,
                  command: server.command
                }
              },
              configScope
            )
          );
        }
      }

      const missingVariables = missingEnvironmentVariables(
        server,
        process.env,
        platform
      );
      if (missingVariables.length > 0) {
        findings.push(
          makeFinding(
            candidate,
            {
              id: `${candidate.clientId}:${server.name}:env-missing`,
              serverName: server.name,
              severity: "error",
              titleKey: "scan.envMissing.title",
              detailKey: "scan.envMissing.detail",
              detailParams: {
                server: server.name,
                variables: missingVariables.join(", ")
              }
            },
            configScope
          )
        );
      }

      if (server.url) {
        try {
          const parsedUrl = new URL(
            expandServerVariables(
              server.url,
              server.variableSyntax,
              process.env,
              platform,
              server.workspaceDir
            )
          );
          const allowedProtocols =
            candidate.clientId === "vscode"
              ? ["http:", "https:", "unix:", "pipe:"]
              : ["http:", "https:"];
          if (!allowedProtocols.includes(parsedUrl.protocol)) {
            throw new Error("Unsupported protocol");
          }
        } catch {
          findings.push(
            makeFinding(
              candidate,
              {
                id: `${candidate.clientId}:${server.name}:url-invalid`,
                serverName: server.name,
                severity: "error",
                titleKey: "scan.urlInvalid.title",
                detailKey: "scan.urlInvalid.detail",
                detailParams: { server: server.name }
              },
              configScope
            )
          );
        }
      }

      if (
        platform === "win32" &&
        candidate.format === "jsonc" &&
        server.repairCompatible !== false &&
        server.command?.toLowerCase() === "npx" &&
        server.args.every(isSafeWindowsCommandArgument)
      ) {
        const repairId = `${candidate.clientId}:${server.name}:wrap-npx:${configScope}`;
        findings.push(
          makeFinding(
            candidate,
            {
              id: `${candidate.clientId}:${server.name}:windows-npx`,
              serverName: server.name,
              severity: "warning",
              titleKey: "scan.windowsNpx.title",
              detailKey: "scan.windowsNpx.detail",
              detailParams: { server: server.name },
              repairId
            },
            configScope
          )
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
          expectedHash: hashText(rawContent)
        });
      }
    }

    if (findings.length === 0) {
      findings.push(
        makeFinding(
          candidate,
          {
            id: `${candidate.clientId}:ok`,
            severity: "info",
            titleKey: "scan.ok.title",
            detailKey: "scan.ok.detail"
          },
          configScope
        )
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
