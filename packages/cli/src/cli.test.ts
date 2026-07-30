import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  options: {
    isolatedHome?: boolean;
    setupHome?: (home: string, appData: string) => Promise<void>;
  } = {}
): Promise<CommandResult> {
  const environment = { ...process.env };
  if (options.isolatedHome || options.setupHome) {
    const home = await mkdtemp(path.join(os.tmpdir(), "mcpmender-cli-home-"));
    const appData = path.join(home, "AppData", "Roaming");
    await mkdir(appData, { recursive: true });
    environment.HOME = home;
    environment.USERPROFILE = home;
    environment.APPDATA = appData;
    environment.XDG_CONFIG_HOME = path.join(home, ".config");
    await options.setupHome?.(home, appData);
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
      stdout: "0.3.0-beta.3\n"
    });
  });

  it("prints discoverable help for every command", async () => {
    const result = await runNode(["help", "--lang", "en"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("MCPMender 0.3.0-beta.3");
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

  it("rejects unknown options and missing option values", async () => {
    const unknown = await runNode(["scan", "--definitely-unknown"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("Unknown option");

    const missing = await runNode(["scan", "--lang"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("--lang requires a value");
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

  it("rejects an unmatched probe server filter instead of reporting 0/0 success", async () => {
    const result = await runNode(
      ["probe", "--run", "--server", "definitely-missing", "--json"],
      { isolatedHome: true }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No configured server matched");
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

  it("redacts API token arguments in end-to-end scan output", async () => {
    const secret = "cli-api-token-secret";
    const cloudSecret = "aws-secret-cli-value";
    const result = await runNode(["scan", "--json", "--lang", "en"], {
      setupHome: async (_home, appData) => {
        const configDir = path.join(appData, "Claude");
        await mkdir(configDir, { recursive: true });
        await writeFile(
          path.join(configDir, "claude_desktop_config.json"),
          JSON.stringify({
            mcpServers: {
              private: {
                command: process.execPath,
                args: [
                  "--api-token",
                  secret,
                  "--env",
                  `AWS_SECRET_ACCESS_KEY=${cloudSecret}`
                ]
              }
            }
          })
        );
      }
    });
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain(cloudSecret);
    expect(result.stdout).toContain("[REDACTED]");
  });

  it("redacts credential URIs emitted by a failing probed server", async () => {
    const password = "probe-db-password";
    const result = await runNode(
      ["probe", "--run", "--server", "leaky", "--json", "--lang", "en"],
      {
        setupHome: async (home, appData) => {
          const serverPath = path.join(home, "leaky-server.mjs");
          await writeFile(
            serverPath,
            `process.stderr.write("DATABASE_URL=postgres://db-user:${password}@example.test/app\\n"); process.exit(1);`
          );
          const configDir = path.join(appData, "Claude");
          await mkdir(configDir, { recursive: true });
          await writeFile(
            path.join(configDir, "claude_desktop_config.json"),
            JSON.stringify({
              mcpServers: {
                leaky: { command: process.execPath, args: [serverPath] }
              }
            })
          );
        }
      }
    );
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain(password);
    expect(result.stdout).toContain("[REDACTED]");
  });
});
