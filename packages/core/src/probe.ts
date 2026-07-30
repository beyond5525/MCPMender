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
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
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
  const stdioPid =
    transport instanceof StdioClientTransport ? transport.pid : null;
  const closePromise = transport.close().catch(() => undefined);
  await Promise.race([
    closePromise,
    new Promise<void>((resolve) => setTimeout(resolve, 750))
  ]);
  if (!stdioPid || !processIsAlive(stdioPid)) return;

  try {
    process.kill(stdioPid, "SIGTERM");
  } catch {
    return;
  }
  if (await waitForProcessExit(stdioPid, 750)) return;

  try {
    process.kill(stdioPid, "SIGKILL");
  } catch {
    return;
  }
  await waitForProcessExit(stdioPid, 1_500);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return !processIsAlive(pid);
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

function combinedProbeSignal(
  timeoutMs: number,
  startedAt: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; timeout: number } {
  const timeout = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const timeoutSignal = AbortSignal.timeout(timeout);
  return {
    signal: externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal,
    timeout
  };
}

function shouldFallbackToSse(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  const detail = safeDetail(error).toLowerCase();
  if (
    detail.includes("401") ||
    detail.includes("403") ||
    detail.includes("unauthorized") ||
    detail.includes("forbidden") ||
    detail.includes("timeout") ||
    detail.includes("timed out") ||
    detail.includes("aborted")
  ) {
    return false;
  }
  return [
    "404",
    "405",
    "406",
    "415",
    "method not allowed",
    "not acceptable",
    "unsupported content-type",
    "invalid content-type",
    "unexpected content",
    "protocol error",
    "connection closed"
  ].some((marker) => detail.includes(marker));
}

async function inspectConnectedTransport(
  target: ProbeTarget,
  transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport,
  timeoutMs: number,
  startedAt: number,
  externalSignal?: AbortSignal
): Promise<ProbeResult> {
  const client = new Client(
    { name: "mcpmender-diagnostics", version: "0.3.0-beta.3" },
    { capabilities: {} }
  );
  const connect = combinedProbeSignal(timeoutMs, startedAt, externalSignal);
  await client.connect(transport, {
    signal: connect.signal,
    timeout: connect.timeout,
    maxTotalTimeout: connect.timeout
  });

  let toolCount: number | undefined;
  if (client.getServerCapabilities()?.tools) {
    toolCount = 0;
    let cursor: string | undefined;
    do {
      const request = combinedProbeSignal(timeoutMs, startedAt, externalSignal);
      const listed = await client.listTools(
        cursor ? { cursor } : undefined,
        {
          signal: request.signal,
          timeout: request.timeout,
          maxTotalTimeout: request.timeout
        }
      );
      toolCount += listed.tools.length;
      cursor = listed.nextCursor;
    } while (cursor);
  }

  const implementation = client.getServerVersion();
  const result: ProbeResult = {
    clientId: target.clientId,
    clientName: target.clientName,
    configPath: target.configPath,
    serverName: target.server.name,
    transport: targetTransport(target),
    status: "connected",
    durationMs: Date.now() - startedAt,
    serverNameReported: implementation?.name,
    serverVersion: implementation?.version,
    toolCount,
    messageKey: "probe.connected"
  };
  const closeBudget = Math.min(
    500,
    Math.max(1, timeoutMs - (Date.now() - startedAt))
  );
  await Promise.race([
    client.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, closeBudget))
  ]);
  return result;
}

async function probeTarget(
  target: ProbeTarget,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<ProbeResult> {
  const startedAt = Date.now();
  const server = target.server;
  let transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined;
  let stderr = "";

  if (server.probeUnsupportedReason) {
    return {
      clientId: target.clientId,
      clientName: target.clientName,
      configPath: target.configPath,
      serverName: server.name,
      transport: targetTransport(target),
      status: "unsupported",
      durationMs: 0,
      messageKey: "probe.unsupported",
      detail: server.probeUnsupportedReason
    };
  }

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
        if (target.clientId === "vscode") {
          try {
            return await inspectConnectedTransport(
              target,
              transport,
              timeoutMs,
              startedAt,
              externalSignal
            );
          } catch (error) {
            await closeQuietly(transport);
            transport = undefined;
            if (!shouldFallbackToSse(error, externalSignal)) throw error;
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
          }
        }
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

    return await inspectConnectedTransport(
      target,
      transport,
      timeoutMs,
      startedAt,
      externalSignal
    );
  } catch (error) {
    return classifyFailure(target, startedAt, error, stderr);
  } finally {
    await closeQuietly(transport);
  }
}

function eligibleProbeTargets(report: Awaited<
  ReturnType<typeof scanMcpConfigurations>
>): ProbeTarget[] {
  const candidates = report.clients.flatMap((client) =>
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
  const effective = new Map<string, ProbeTarget & { precedence?: number }>();
  for (const target of candidates) {
    const source = report.clients.find(
      (client) =>
        client.clientId === target.clientId &&
        client.configPath === target.configPath
    );
    const key = `${target.clientId}:${target.server.name}`;
    const existing = effective.get(key);
    if (source?.precedence === undefined) {
      effective.set(`${key}:${target.configPath}`, {
        ...target,
        precedence: undefined
      });
      continue;
    }
    if (!existing) {
      effective.set(key, { ...target, precedence: source.precedence });
      continue;
    }
    const existingPrecedence = existing.precedence ?? -Infinity;
    if (source.precedence > existingPrecedence) {
      for (const candidateKey of effective.keys()) {
        if (candidateKey === key || candidateKey.startsWith(`${key}:`)) {
          effective.delete(candidateKey);
        }
      }
      effective.set(key, { ...target, precedence: source.precedence });
    } else if (source.precedence === existingPrecedence) {
      effective.set(`${key}:${target.configPath}`, {
        ...target,
        precedence: source.precedence
      });
    }
  }
  return [...effective.values()].map(({ precedence: _precedence, ...target }) => target);
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
        if (options.signal?.aborted) break;
        const index = nextIndex++;
        results[index] = await probeTarget(
          targets[index],
          timeoutMs,
          options.signal
        );
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
    signal: options.signal,
    platform: options.scanOptions?.platform
  });
}

export function describeProbeTarget(server: ServerDefinition): string {
  return server.url
    ? server.url
    : [server.command, ...server.args].filter(Boolean).join(" ");
}
