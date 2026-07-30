import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySafeRepairs,
  redactReport,
  redactText,
  rollbackRepair,
  scanMcpConfigurations,
  type RepairAction
} from "./index.js";

function repair(
  configPath: string,
  original: string,
  args: string[],
  serverName = "fixture"
): RepairAction {
  return {
    id: `cursor:${serverName}:wrap-npx`,
    clientId: "cursor",
    clientName: "Cursor",
    configPath,
    serverName,
    risk: "safe",
    kind: "wrap-windows-npx",
    titleKey: "repair.windowsNpx.title",
    detailKey: "repair.windowsNpx.detail",
    before: { command: "npx", args },
    after: { command: "cmd", args: ["/d", "/s", "/c", "npx", ...args] },
    expectedHash: createHash("sha256").update(original).digest("hex")
  };
}

async function writeNpxConfig(
  configPath: string,
  args: string[] = ["-y", "@example/mcp"]
): Promise<string> {
  await mkdir(path.dirname(configPath), { recursive: true });
  const content = JSON.stringify(
    {
      mcpServers: {
        fixture: {
          command: "npx",
          args
        }
      }
    },
    null,
    2
  );
  await writeFile(configPath, content, "utf8");
  return content;
}

describe("structured secret redaction", () => {
  it("redacts URL credentials, every query value, fragments, and auth schemes", () => {
    const input = [
      "https://alice:hunter2@example.test/mcp?token=secret-value&custom=private#fragment",
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "Authorization: Bearer opaque-access-token"
    ].join("\n");
    const output = redactText(input);

    for (const secret of [
      "alice",
      "hunter2",
      "secret-value",
      "private",
      "fragment",
      "dXNlcjpwYXNzd29yZA==",
      "opaque-access-token"
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("redacts camel-case sensitive keys and adjacent CLI secret values", () => {
    const output = redactText(
      [
        "apiKey=plain-api-key",
        "clientSecret: plain-client-secret",
        "--token adjacent-token",
        "--access-token=joined-token",
        "--password:'quoted-password'"
      ].join(" ")
    );

    for (const secret of [
      "plain-api-key",
      "plain-client-secret",
      "adjacent-token",
      "joined-token",
      "quoted-password"
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it("redacts values based on structured key names without mutating input", () => {
    const source = {
      apiKey: "one",
      client_secret: "two",
      nested: {
        accessToken: "three",
        password: "four",
        harmless: "visible"
      }
    };
    const redacted = redactReport(source);

    expect(redacted).toEqual({
      apiKey: "[REDACTED]",
      client_secret: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        password: "[REDACTED]",
        harmless: "visible"
      }
    });
    expect(source.apiKey).toBe("one");
    expect(source.nested.accessToken).toBe("three");
  });

  it("redacts secret values stored as the next element in an argument array", () => {
    const source = {
      args: ["--api-key", "array-secret", "--token=joined-secret", "--safe", "ok"]
    };
    expect(redactReport(source)).toEqual({
      args: ["--api-key", "[REDACTED]", "--token=[REDACTED]", "--safe", "ok"]
    });
    expect(source.args[1]).toBe("array-secret");
  });

  it("redacts common prefixed names, API token flags, auth values, and credential URIs", () => {
    const source = {
      args: [
        "--api-token",
        "api-token-secret",
        "--env",
        "AWS_SECRET_ACCESS_KEY=aws-secret-access"
      ],
      MCP_API_KEY: "structured-api-secret",
      DATABASE_URL: "postgres://db-user:db-password@example.test/app"
    };
    const redacted = JSON.stringify(redactReport(source));
    const text = redactText(
      [
        'Authorization: Digest username="db-user", realm="internal", response="digest-secret"',
        "DATABASE_URL=postgres://db-user:db-password@example.test/app",
        "X-Secret-Key: custom-header-secret",
        "-----BEGIN PRIVATE KEY-----",
        "pem-private-material",
        "-----END PRIVATE KEY-----"
      ].join("\n")
    );

    for (const secret of [
      "api-token-secret",
      "structured-api-secret",
      "aws-secret-access",
      "db-user",
      "db-password",
      "digest-secret",
      "custom-header-secret",
      "pem-private-material"
    ]) {
      expect(redacted).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain("internal");
  });
});

describe("repair transaction hardening", () => {
  it("uses distinct backup paths for same-named configurations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-collision-"));
    const firstPath = path.join(root, "one", "mcp.json");
    const secondPath = path.join(root, "two", "mcp.json");
    const firstArgs = ["-y", "@example/one"];
    const secondArgs = ["-y", "@example/two"];
    const first = await writeNpxConfig(firstPath, firstArgs);
    const second = await writeNpxConfig(secondPath, secondArgs);

    const result = await applySafeRepairs(
      [
        repair(firstPath, first, firstArgs),
        repair(secondPath, second, secondArgs)
      ],
      { backupRoot: path.join(root, "backups") }
    );
    const backupPaths = result.results.map((item) => item.backupPath);

    expect(result.results.every((item) => item.applied)).toBe(true);
    expect(new Set(backupPaths).size).toBe(2);
    expect(await readFile(backupPaths[0]!, "utf8")).toBe(first);
    expect(await readFile(backupPaths[1]!, "utf8")).toBe(second);
  });

  it("performs a second hash check and preserves a concurrent user edit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-race-"));
    const configPath = path.join(root, "mcp.json");
    const args = ["-y", "@example/mcp"];
    const original = await writeNpxConfig(configPath, args);
    const userEdit = `${original}\n// concurrent user edit\n`;

    const result = await applySafeRepairs([repair(configPath, original, args)], {
      backupRoot: path.join(root, "backups"),
      beforeCommit: async () => {
        await writeFile(configPath, userEdit, "utf8");
      }
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      applied: false,
      messageKey: "repair.skippedChanged"
    });
    expect(await readFile(configPath, "utf8")).toBe(userEdit);
    expect(await readFile(result.results[0].backupPath!, "utf8")).toBe(original);
    expect(
      (await readdir(root)).some((name) => name.includes(".mcpmender-"))
    ).toBe(false);
  });

  it("rejects cmd metacharacters instead of creating an injectable repair", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-cmd-"));
    const configPath = path.join(root, "mcp.json");
    const args = [
      "-y",
      "@example/mcp",
      "&",
      "calc.exe"
    ];
    const original = await writeNpxConfig(configPath, args);
    const scan = await scanMcpConfigurations({
      platform: "win32",
      candidates: [
        {
          clientId: "cursor",
          displayName: "Cursor",
          path: configPath,
          format: "jsonc"
        }
      ]
    });

    expect(scan.repairs).toHaveLength(0);

    const result = await applySafeRepairs([repair(configPath, original, args)], {
      backupRoot: path.join(root, "backups")
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      applied: false,
      messageKey: "repair.failed"
    });
    expect(result.results[0].backupPath).toBeUndefined();
    expect(await readFile(configPath, "utf8")).toBe(original);
  });

  it("refuses rollback when the current configuration no longer matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-rollback-race-"));
    const configPath = path.join(root, "mcp.json");
    const backupPath = path.join(root, "backup.json");
    await writeFile(configPath, "new user content", "utf8");
    await writeFile(backupPath, "old backup", "utf8");

    await expect(
      rollbackRepair(backupPath, configPath, {
        expectedCurrentHash: createHash("sha256")
          .update("expected repaired content")
          .digest("hex")
      })
    ).rejects.toThrow("ROLLBACK_CONFIG_CHANGED");
    expect(await readFile(configPath, "utf8")).toBe("new user content");
  });

  it("preserves a UTF-8 BOM while applying a scanned repair", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-bom-repair-"));
    const configPath = path.join(root, "mcp.json");
    const original = `\uFEFF${await writeNpxConfig(configPath)}`;
    await writeFile(configPath, original, "utf8");
    const scan = await scanMcpConfigurations({
      platform: "win32",
      candidates: [
        {
          clientId: "cursor",
          displayName: "Cursor",
          path: configPath,
          format: "jsonc"
        }
      ]
    });

    const result = await applySafeRepairs(scan.repairs, {
      backupRoot: path.join(root, "backups")
    });
    const repaired = await readFile(configPath, "utf8");
    expect(result.results[0]?.applied).toBe(true);
    expect(repaired.startsWith("\uFEFF")).toBe(true);
    expect(repaired).toContain('"command": "cmd"');
  });

  it("isolates a missing file and continues repairing the rest of a batch", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-isolated-"));
    const missingPath = path.join(root, "missing.json");
    const healthyPath = path.join(root, "healthy.json");
    const missingOriginal = await writeNpxConfig(missingPath);
    const healthyOriginal = await writeNpxConfig(healthyPath);
    await rm(missingPath);

    const result = await applySafeRepairs(
      [
        repair(missingPath, missingOriginal, ["-y", "@example/mcp"], "missing"),
        repair(healthyPath, healthyOriginal, ["-y", "@example/mcp"], "healthy")
      ],
      { backupRoot: path.join(root, "backups") }
    );

    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repairId: "cursor:missing:wrap-npx", applied: false }),
        expect.objectContaining({ repairId: "cursor:healthy:wrap-npx", applied: true })
      ])
    );
    expect(await readFile(healthyPath, "utf8")).toContain('"command": "cmd"');
  });

  it("reports a manifest warning without hiding a committed repair", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcpmender-manifest-"));
    const configPath = path.join(root, "mcp.json");
    const original = await writeNpxConfig(configPath);

    const result = await applySafeRepairs(
      [repair(configPath, original, ["-y", "@example/mcp"])],
      {
        backupRoot: path.join(root, "backups"),
        beforeManifest: async () => {
          throw new Error("simulated manifest write failure");
        }
      }
    );

    expect(result).toMatchObject({
      manifestWarning: "REPAIR_MANIFEST_SAVE_FAILED",
      results: [expect.objectContaining({ applied: true })]
    });
    expect(await readFile(configPath, "utf8")).toContain('"command": "cmd"');
  });
});
