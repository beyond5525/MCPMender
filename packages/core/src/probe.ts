import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveExecutable } from "./environment.js";
import { redactText } from "./redaction.js";
import { scanMcpConfigurations } from "./scanner.js";
import type {
  ProbeOptions,
  ProbeReport,
  ProbeResult,
  ProbeTarget,
  ServerDefinition
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 8_000;

function safeDetail(error: unknown, extra = ""): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(`${message}${extra ? ` · ${extra}` : ""}`, os.homedir())
    .replace(/\s+/g, " ")
    .slice(0, 500);
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
    transport: target.server.url ? "http" : "stdio",
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
  transport: StdioClientTransport | StreamableHTTPClientTransport | undefined
): Promise<void> {
  if (!transport) return;
  await Promise.race([
    transport.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 750))
  ]);
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
    if (server.command) {
      const childEnvironment = {
        ...getDefaultEnvironment(),
        ...(server.env ?? {})
      };
      const executable = await resolveExecutable(server.command, {
        environment: childEnvironment
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
        args: server.args,
        cwd: server.cwd,
        env: childEnvironment,
        stderr: "pipe"
      });
      transport.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2_000);
      });
    } else {
      transport = new StreamableHTTPClientTransport(new URL(server.url!), {
        requestInit:
          server.headers && Object.keys(server.headers).length > 0
            ? { headers: server.headers }
            : undefined
      });
    }

    const client = new Client(
      { name: "mcpulse-diagnostics", version: "0.2.0" },
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
      transport: server.url ? "http" : "stdio",
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

export async function planProbeTargets(
  scanOptions: ProbeOptions["scanOptions"] = {}
): Promise<ProbeTarget[]> {
  const report = await scanMcpConfigurations(scanOptions);
  return report.clients.flatMap((client) =>
    client.parseable
      ? client.servers.map((server) => ({
          clientId: client.clientId,
          clientName: client.displayName,
          configPath: client.configPath,
          server: {
            ...server,
            envKeys: undefined,
            command: server.command
              ? redactText(server.command, os.homedir())
              : undefined,
            args: server.args.map((argument) =>
              redactText(argument, os.homedir())
            ),
            url: server.url
              ? redactText(server.url, os.homedir())
              : undefined
          }
        }))
      : []
  );
}

export async function probeMcpConfigurations(
  options: ProbeOptions = {}
): Promise<ProbeReport> {
  const timeoutMs = Math.min(
    60_000,
    Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  );
  const concurrency = Math.min(4, Math.max(1, options.concurrency ?? 2));
  const report = await scanMcpConfigurations({
    ...(options.scanOptions ?? {}),
    includeSensitive: true
  });
  let targets = report.clients.flatMap((client) =>
    client.parseable
      ? client.servers.map((server) => ({
          clientId: client.clientId,
          clientName: client.displayName,
          configPath: client.configPath,
          server
        }))
      : []
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
    platform: options.scanOptions?.platform ?? process.platform,
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

export function describeProbeTarget(server: ServerDefinition): string {
  return server.url
    ? server.url
    : [server.command, ...server.args].filter(Boolean).join(" ");
}
