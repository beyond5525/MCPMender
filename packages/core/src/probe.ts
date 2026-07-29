import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  expandServerVariables,
  resolveExecutable
} from "./environment.js";
import { redactReport, redactText } from "./redaction.js";
import { scanMcpConfigurations } from "./scanner.js";
import type {
  ProbeOptions,
  ProbeReport,
  ProbeResult,
  ProbeTarget,
  ProbeTargetOptions,
  ServerDefinition
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 8_000;

function safeDetail(error: unknown, extra = ""): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(`${message}${extra ? ` · ${extra}` : ""}`, os.homedir())
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function targetTransport(target: ProbeTarget): "stdio" | "http" | "sse" {
  return (
    target.server.transport ??
    (target.server.command ? "stdio" : target.server.url ? "http" : "stdio")
  );
}

function classifyFailure(
  target: ProbeTarget,
  startedAt: number,
  error: unknown,
  stderr = ""
): ProbeResult {
  const detail = safeDetail(error, stderr);
  const normalized = detail.toLowerCase();
  const status =
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("authorization required")
      ? "auth-required"
      : normalized.includes("timeout") ||
          normalized.includes("timed out") ||
          normalized.includes("aborted")
        ? "timeout"
        : normalized.includes("enoent") || normalized.includes("not found")
          ? "not-found"
          : "failed";
  return {
    clientId: target.clientId,
    clientName: target.clientName,
    configPath: target.configPath,
    serverName: target.server.name,
    transport: targetTransport(target),
    status,
    durationMs: Date.now() - startedAt,
    messageKey:
      status === "auth-required"
        ? "probe.authRequired"
        : status === "timeout"
          ? "probe.timeout"
          : status === "not-found"
            ? "probe.notFound"
            : "probe.failed",
    detail
  };
}

async function closeQuietly(
  transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined
): Promise<void> {
  if (!transport) return;
  await Promise.race([
    transport.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 750))
  ]);
}

function environmentValue(name: string): string | undefined {
  const direct = process.env[name];
  if (direct !== undefined || process.platform !== "win32") return direct;
  const matchingKey = Object.keys(process.env).find(
    (key) => key.toLowerCase() === name.toLowerCase()
  );
  return matchingKey ? process.env[matchingKey] : undefined;
}

function resolvedEnvironment(server: ServerDefinition): Record<string, string> {
  const childEnvironment: Record<string, string> = {
    ...getDefaultEnvironment()
  };
  for (const key of server.inheritEnvKeys ?? []) {
    const value = environmentValue(key);
    if (value !== undefined) childEnvironment[key] = value;
  }
  for (const [key, value] of Object.entries(server.env ?? {})) {
    childEnvironment[key] = expandServerVariables(
      value,
      server.variableSyntax,
      process.env,
      process.platform,
      server.workspaceDir
    );
  }
  return childEnvironment;
}

function resolvedHeaders(server: ServerDefinition): Record<string, string> {
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([name, value]) => [
      name,
      expandServerVariables(
        value,
        server.variableSyntax,
        process.env,
        process.platform,
        server.workspaceDir
      )
    ])
  );
  for (const [headerName, environmentName] of Object.entries(
    server.headerEnv ?? {}
  )) {
    const value = environmentValue(environmentName);
    if (value !== undefined) headers[headerName] = value;
  }
  const hasAuthorization = Object.keys(headers).some(
    (name) => name.toLowerCase() === "authorization"
  );
  if (server.bearerTokenEnvVar && !hasAuthorization) {
    const token = environmentValue(server.bearerTokenEnvVar);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mergeHeaders(
  original: HeadersInit | undefined,
  additions: Record<string, string>
): Headers {
  const headers = new Headers(original);
  for (const [name, value] of Object.entries(additions)) {
    headers.set(name, value);
  }
  return headers;
}

async function probeTarget(
  target: ProbeTarget,
  timeoutMs: number
): Promise<ProbeResult> {
  const startedAt = Date.now();
  const server = target.server;
  let transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined;
  let stderr = "";

  if (!server.command && !server.url) {
    return {
      clientId: target.clientId,
      clientName: target.clientName,
      configPath: target.configPath,
      serverName: server.name,
      transport: "stdio",
      status: "unsupported",
      durationMs: 0,
      messageKey: "probe.unsupported",
      detail: "No stdio command or Streamable HTTP URL is configured."
    };
  }

  try {
    const transportKind = targetTransport(target);
    if (transportKind === "stdio" && server.command) {
      const childEnvironment = resolvedEnvironment(server);
      const executable = await resolveExecutable(server.command, {
        environment: childEnvironment,
        cwd: server.cwd,
        variableSyntax: server.variableSyntax,
        workspaceDir: server.workspaceDir
      });
      if (!executable) {
        return {
          clientId: target.clientId,
          clientName: target.clientName,
          configPath: target.configPath,
          serverName: server.name,
          transport: "stdio",
          status: "not-found",
          durationMs: Date.now() - startedAt,
          messageKey: "probe.notFound",
          detail: `Command not found: ${server.command}`
        };
      }
      transport = new StdioClientTransport({
        command: executable,
        args: server.args.map((argument) =>
          expandServerVariables(
            argument,
            server.variableSyntax,
            process.env,
            process.platform,
            server.workspaceDir
          )
        ),
        cwd: server.cwd
          ? expandServerVariables(
              server.cwd,
              server.variableSyntax,
              process.env,
              process.platform,
              server.workspaceDir
            )
          : undefined,
        env: childEnvironment,
        stderr: "pipe"
      });
      transport.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2_000);
      });
    } else if (server.url) {
      const url = new URL(
        expandServerVariables(
          server.url,
          server.variableSyntax,
          process.env,
          process.platform,
          server.workspaceDir
        )
      );
      const headers = resolvedHeaders(server);
      if (transportKind === "sse") {
        transport = new SSEClientTransport(url, {
          eventSourceInit:
            Object.keys(headers).length > 0
              ? {
                  fetch: (input, init) =>
                    fetch(input, {
                      ...init,
                      headers: mergeHeaders(init.headers, headers)
                    })
                }
              : undefined,
          requestInit:
            Object.keys(headers).length > 0 ? { headers } : undefined
        });
      } else {
        transport = new StreamableHTTPClientTransport(url, {
          requestInit:
            Object.keys(headers).length > 0 ? { headers } : undefined
        });
      }
    } else {
      return {
        clientId: target.clientId,
        clientName: target.clientName,
        configPath: target.configPath,
        serverName: server.name,
        transport: transportKind,
        status: "unsupported",
        durationMs: Date.now() - startedAt,
        messageKey: "probe.unsupported",
        detail: "The configured transport is missing its command or URL."
      };
    }

    const client = new Client(
      { name: "mcpmender-diagnostics", version: "0.3.0-beta.2" },
      { capabilities: {} }
    );
    const signal = AbortSignal.timeout(timeoutMs);
    await client.connect(transport, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs
    });

    let toolCount: number | undefined;
    if (client.getServerCapabilities()?.tools) {
      const remaining = Math.max(250, timeoutMs - (Date.now() - startedAt));
      const listed = await client.listTools(undefined, {
        signal,
        timeout: remaining,
        maxTotalTimeout: remaining
      });
      toolCount = listed.tools.length;
    }

    const implementation = client.getServerVersion();
    const result: ProbeResult = {
      clientId: target.clientId,
      clientName: target.clientName,
      configPath: target.configPath,
      serverName: server.name,
      transport: transportKind,
      status: "connected",
      durationMs: Date.now() - startedAt,
      serverNameReported: implementation?.name,
      serverVersion: implementation?.version,
      toolCount,
      messageKey: "probe.connected"
    };
    await client.close();
    transport = undefined;
    return result;
  } catch (error) {
    return classifyFailure(target, startedAt, error, stderr);
  } finally {
    await closeQuietly(transport);
  }
}

function eligibleProbeTargets(report: Awaited<
  ReturnType<typeof scanMcpConfigurations>
>): ProbeTarget[] {
  return report.clients.flatMap((client) =>
    client.parseable
      ? client.servers
          .filter(
            (server) =>
              server.enabled !== false &&
              (server.unresolvedVariables?.length ?? 0) === 0
          )
          .map((server) => ({
            clientId: client.clientId,
            clientName: client.displayName,
            configPath: client.configPath,
            server
          }))
      : []
  );
}

export async function loadProbeTargets(
  scanOptions: ProbeOptions["scanOptions"] = {}
): Promise<ProbeTarget[]> {
  const report = await scanMcpConfigurations({
    ...(scanOptions ?? {}),
    includeSensitive: true
  });
  return eligibleProbeTargets(report);
}

export function previewProbeTargets(
  targets: ProbeTarget[]
): ProbeTarget[] {
  return targets.map((target) => ({
    ...target,
    server: redactReport(
      {
        ...target.server,
        env: undefined,
        envKeys: undefined,
        headers: undefined
      },
      os.homedir()
    )
  }));
}

export async function planProbeTargets(
  scanOptions: ProbeOptions["scanOptions"] = {}
): Promise<ProbeTarget[]> {
  return previewProbeTargets(await loadProbeTargets(scanOptions));
}

export async function probeMcpTargets(
  inputTargets: ProbeTarget[],
  options: ProbeTargetOptions = {}
): Promise<ProbeReport> {
  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  );
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 2));
  let targets = inputTargets.filter(
    (target) =>
      target.server.enabled !== false &&
      (target.server.unresolvedVariables?.length ?? 0) === 0
  );
  if (options.serverNames && options.serverNames.length > 0) {
    const selected = new Set(options.serverNames);
    targets = targets.filter(
      (target) =>
        selected.has(target.server.name) ||
        selected.has(`${target.clientId}/${target.server.name}`)
    );
  }

  const results: ProbeResult[] = [];
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (nextIndex < targets.length) {
        const index = nextIndex++;
        results[index] = await probeTarget(targets[index], timeoutMs);
      }
    })
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: options.platform ?? process.platform,
    results,
    summary: {
      total: results.length,
      connected: results.filter((result) => result.status === "connected")
        .length,
      authRequired: results.filter(
        (result) => result.status === "auth-required"
      ).length,
      failed: results.filter(
        (result) =>
          !["connected", "auth-required"].includes(result.status)
      ).length
    }
  };
}

export async function probeMcpConfigurations(
  options: ProbeOptions = {}
): Promise<ProbeReport> {
  const targets = await loadProbeTargets(options.scanOptions);
  return probeMcpTargets(targets, {
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
    serverNames: options.serverNames,
    platform: options.scanOptions?.platform
  });
}

export function describeProbeTarget(server: ServerDefinition): string {
  return server.url
    ? server.url
    : [server.command, ...server.args].filter(Boolean).join(" ");
}
