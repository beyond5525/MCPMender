import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const entryPoint = path.join(packageRoot, "dist", "mcpmender.cjs");

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function runNode(
  args: string[],
  options: { isolatedHome?: boolean } = {}
): Promise<CommandResult> {
  const environment = { ...process.env };
  if (options.isolatedHome) {
    const home = await mkdtemp(path.join(os.tmpdir(), "mcpmender-cli-home-"));
    const appData = path.join(home, "AppData", "Roaming");
    await mkdir(appData, { recursive: true });
    environment.HOME = home;
    environment.USERPROFILE = home;
    environment.APPDATA = appData;
    environment.XDG_CONFIG_HOME = path.join(home, ".config");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint, ...args], {
      cwd: packageRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

beforeAll(async () => {
  const result = await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], {
      cwd: packageRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
  expect(result, result.stderr).toMatchObject({ exitCode: 0 });
}, 30_000);

describe("packaged CLI entry point", () => {
  it("prints the beta version", async () => {
    const result = await runNode(["--version"]);
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "0.3.0-beta.1\n"
    });
  });

  it("prints discoverable help for every command", async () => {
    const result = await runNode(["help", "--lang", "en"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MCPMender 0.3.0-beta.1");
    expect(result.stdout).toContain("mcpmender scan");
    expect(result.stdout).toContain("mcpmender probe");
    expect(result.stdout).toContain("mcpmender repair");
  });

  it("rejects an unknown command instead of silently scanning", async () => {
    const result = await runNode(["definitely-not-a-command", "--lang", "en"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.toLowerCase()).toContain("unknown command");
  });

  it("rejects an invalid probe timeout before starting configured servers", async () => {
    const result = await runNode([
      "probe",
      "--run",
      "--timeout",
      "not-a-number",
      "--lang",
      "en"
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.toLowerCase()).toContain("--timeout");
  });

  it("emits machine-readable, secret-redacted scan JSON", async () => {
    const result = await runNode(["scan", "--json", "--lang", "en"], {
      isolatedHome: true
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      platform: string;
      clients: unknown[];
      summary: Record<string, number>;
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.platform).toBe(process.platform);
    expect(Array.isArray(report.clients)).toBe(true);
    expect(report.summary).toEqual(
      expect.objectContaining({
        detectedClients: expect.any(Number),
        configuredServers: expect.any(Number),
        errors: expect.any(Number),
        warnings: expect.any(Number),
        safeRepairs: expect.any(Number)
      })
    );
    expect(result.stdout).not.toMatch(
      /\b(?:sk-|github_pat_|ghp_|Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/i
    );
  });
});
