import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
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

function canonicalConfigPath(configPath: string): string {
  const resolved = path.resolve(configPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function backupName(configPath: string, clientId: string): string {
  const pathDigest = createHash("sha256")
    .update(canonicalConfigPath(configPath))
    .digest("hex")
    .slice(0, 12);
  return `${clientId}-${path.basename(configPath)}-${pathDigest}.bak`;
}

export function isSafeWindowsCommandArgument(argument: string): boolean {
  return (
    argument.length > 0 &&
    !/[\u0000-\u0020\u007f"&|<>()^%!]/.test(argument)
  );
}

function isSafeWindowsNpxRepair(repair: RepairAction): boolean {
  if (
    repair.kind !== "wrap-windows-npx" ||
    repair.before.command.toLowerCase() !== "npx" ||
    repair.after.command.toLowerCase() !== "cmd"
  ) {
    return false;
  }

  const [disableAutorun, quoteMode, commandMode, wrappedCommand, ...wrappedArgs] =
    repair.after.args;
  if (
    disableAutorun?.toLowerCase() !== "/d" ||
    quoteMode?.toLowerCase() !== "/s" ||
    commandMode?.toLowerCase() !== "/c" ||
    wrappedCommand?.toLowerCase() !== "npx" ||
    wrappedArgs.length !== repair.before.args.length ||
    !wrappedArgs.every((argument, index) => argument === repair.before.args[index])
  ) {
    return false;
  }

  return repair.before.args.every(isSafeWindowsCommandArgument);
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
  options: {
    backupRoot?: string;
    beforeCommit?: (configPath: string) => Promise<void>;
  } = {}
): Promise<RepairBatchResult> {
  const transactionId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const backupRoot =
    options.backupRoot ?? path.join(os.homedir(), ".mcpmender", "backups");
  const transactionDir = path.join(backupRoot, transactionId);
  await mkdir(backupRoot, { recursive: true });
  await mkdir(transactionDir);

  const results: RepairResult[] = [];
  const grouped = new Map<
    string,
    { configPath: string; repairs: RepairAction[] }
  >();
  for (const repair of repairs) {
    const key = canonicalConfigPath(repair.configPath);
    const current = grouped.get(key) ?? {
      configPath: repair.configPath,
      repairs: []
    };
    current.repairs.push(repair);
    grouped.set(key, current);
  }

  for (const { configPath, repairs: fileRepairs } of grouped.values()) {
    const original = await readFile(configPath, "utf8");
    const hashMatched = fileRepairs.filter(
      (repair) =>
        repair.risk === "safe" && repair.expectedHash === hashText(original)
    );

    for (const skipped of fileRepairs.filter(
      (repair) => !hashMatched.includes(repair)
    )) {
      results.push({
        repairId: skipped.id,
        applied: false,
        configPath,
        messageKey: "repair.skippedChanged"
      });
    }

    const allowed = hashMatched.filter(isSafeWindowsNpxRepair);
    for (const rejected of hashMatched.filter(
      (repair) => !allowed.includes(repair)
    )) {
      results.push({
        repairId: rejected.id,
        applied: false,
        configPath,
        messageKey: "repair.failed"
      });
    }

    if (allowed.length === 0) continue;

    const backupPath = path.join(
      transactionDir,
      backupName(configPath, allowed[0].clientId)
    );
    const originalMode = (await stat(configPath)).mode;
    await writeFile(backupPath, original, {
      encoding: "utf8",
      flag: "wx",
      mode: originalMode
    });

    let updated = original;
    const tempPath = `${configPath}.mcpmender-${transactionId}-${randomUUID()}.tmp`;
    let committed = false;
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

      await writeFile(tempPath, updated, {
        encoding: "utf8",
        flag: "wx",
        mode: originalMode
      });
      await chmod(tempPath, originalMode);
      await options.beforeCommit?.(configPath);

      const immediatelyBeforeCommit = await readFile(configPath, "utf8");
      if (hashText(immediatelyBeforeCommit) !== hashText(original)) {
        await rm(tempPath, { force: true });
        for (const repair of allowed) {
          results.push({
            repairId: repair.id,
            applied: false,
            backupPath,
            configPath,
            messageKey: "repair.skippedChanged"
          });
        }
        continue;
      }

      await rename(tempPath, configPath);
      committed = true;
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
      if (!committed) {
        await rm(tempPath, { force: true });
      }
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
  configPath: string,
  options: { expectedCurrentHash?: string } = {}
): Promise<void> {
  const tempPath = `${configPath}.mcpmender-rollback-${randomUUID()}.tmp`;
  await copyFile(backupPath, tempPath);
  try {
    if (options.expectedCurrentHash) {
      const current = await readFile(configPath);
      if (hashText(current.toString("utf8")) !== options.expectedCurrentHash) {
        throw new Error("ROLLBACK_CONFIG_CHANGED");
      }
    }
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
