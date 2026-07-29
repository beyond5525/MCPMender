import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyEdits,
  modify,
  parse,
  type FormattingOptions,
  type ParseError
} from "jsonc-parser";
import type {
  RepairAction,
  RepairBatchResult,
  RepairResult
} from "./types.js";

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
function serverPath(text: string, serverName: string): (string | number)[] {
  const parsed = parse(text) as Record<string, unknown>;
  if (parsed.mcpServers) return ["mcpServers", serverName];
  if (parsed.mcp && typeof parsed.mcp === "object") {
    return ["mcp", "servers", serverName];
  }
  return ["servers", serverName];
}

function formattingFor(text: string): FormattingOptions {
  const usesTabs = /^\t/m.test(text);
  const indentMatch = text.match(/\n( +)"/);
  return {
    insertSpaces: !usesTabs,
    tabSize: usesTabs ? 1 : Math.max(2, indentMatch?.[1].length ?? 2),
    eol: text.includes("\r\n") ? "\r\n" : "\n"
  };
}

function applyRepairToJsonc(text: string, repair: RepairAction): string {
  const basePath = serverPath(text, repair.serverName);
  const formatting = formattingFor(text);
  let updated = applyEdits(
    text,
    modify(text, [...basePath, "command"], repair.after.command, {
      formattingOptions: formatting
    })
  );
  updated = applyEdits(
    updated,
    modify(updated, [...basePath, "args"], repair.after.args, {
      formattingOptions: formatting
    })
  );
  return updated;
}

export async function applySafeRepairs(
  repairs: RepairAction[],
  options: { backupRoot?: string } = {}
): Promise<RepairBatchResult> {
  const transactionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupRoot =
    options.backupRoot ?? path.join(os.homedir(), ".mcpmender", "backups");
  const transactionDir = path.join(backupRoot, transactionId);
  await mkdir(transactionDir, { recursive: true });

  const results: RepairResult[] = [];
  const grouped = new Map<string, RepairAction[]>();
  for (const repair of repairs) {
    const current = grouped.get(repair.configPath) ?? [];
    current.push(repair);
    grouped.set(repair.configPath, current);
  }

  for (const [configPath, fileRepairs] of grouped) {
    const original = await readFile(configPath, "utf8");
    const allowed = fileRepairs.filter(
      (repair) =>
        repair.risk === "safe" && repair.expectedHash === hashText(original)
    );

    for (const skipped of fileRepairs.filter(
      (repair) => !allowed.includes(repair)
    )) {
      results.push({
        repairId: skipped.id,
        applied: false,
        configPath,
        messageKey: "repair.skippedChanged"
      });
    }

    if (allowed.length === 0) continue;

    const backupPath = path.join(
      transactionDir,
      `${allowed[0].clientId}-${path.basename(configPath)}`
    );
    await copyFile(configPath, backupPath);

    let updated = original;
    try {
      for (const repair of allowed) {
        updated = applyRepairToJsonc(updated, repair);
      }

      const errors: ParseError[] = [];
      parse(updated, errors, {
        allowTrailingComma: true,
        disallowComments: false
      });
      if (errors.length > 0) {
        throw new Error("Repair produced invalid JSONC");
      }

      const tempPath = `${configPath}.mcpmender-${transactionId}.tmp`;
      await writeFile(tempPath, updated, "utf8");
      await copyFile(tempPath, configPath);
      await rm(tempPath, { force: true });

      for (const repair of allowed) {
        results.push({
          repairId: repair.id,
          applied: true,
          backupPath,
          configPath,
          messageKey: "repair.applied"
        });
      }
    } catch {
      await copyFile(backupPath, configPath);
      await rm(`${configPath}.mcpmender-${transactionId}.tmp`, { force: true });
      for (const repair of allowed) {
        results.push({
          repairId: repair.id,
          applied: false,
          backupPath,
          configPath,
          messageKey: "repair.failed"
        });
      }
    }
  }

  await writeFile(
    path.join(transactionDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        transactionId,
        createdAt: new Date().toISOString(),
        files: [...new Set(results.flatMap((result) => result.backupPath ?? []))]
      },
      null,
      2
    ),
    "utf8"
  );

  return { transactionId, results };
}

export async function rollbackRepair(
  backupPath: string,
  configPath: string
): Promise<void> {
  const tempPath = `${configPath}.mcpmender-rollback.tmp`;
  await copyFile(backupPath, tempPath);
  await copyFile(tempPath, configPath);
  await rm(tempPath, { force: true });
}
