import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  accessSync,
  constants,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent
} from "electron";
import {
  applySafeRepairs,
  loadProbeTargets,
  previewProbeTargets,
  probeMcpTargets,
  redactReport,
  rollbackRepair,
  scanMcpConfigurations,
  type ProbeReport,
  type ProbeResult,
  type ProbeTarget,
  type RepairBatchResult,
  type ScanReport
} from "@mcpmender/core";

let mainWindow: BrowserWindow | undefined;
let helpWindow: BrowserWindow | undefined;
let helpWindowLocale: DesktopLocale = "en";
let selectedProjectDir: string | undefined;
let lastScanReport: ScanReport | undefined;
let pendingProbeSnapshot: ProbeTarget[] | undefined;
let activeProbe:
  | {
      controller: AbortController;
      senderId: number;
    }
  | undefined;
let quitAfterProbe = false;
let forceQuitTimer: NodeJS.Timeout | undefined;

app.setName("MCPMender");

interface StorageInfo {
  dataDir: string;
  portable: boolean;
  fallback: boolean;
}

interface RollbackHistoryEntry {
  id: string;
  transactionId: string;
  createdAt: string;
  clientName: string;
  configPath: string;
  backupPath: string;
  backupHash: string;
  repairedHash: string;
  rolledBackAt?: string;
}

interface RollbackHistoryFile {
  schemaVersion: 1;
  transactionId: string;
  createdAt: string;
  entries: RollbackHistoryEntry[];
}

type DesktopLocale = "en" | "zh-CN" | "ja";

interface DesktopDialogMessages {
  projectTitle: string;
  exportTitle: string;
  helpTitle: string;
}

const desktopDialogMessages: Record<DesktopLocale, DesktopDialogMessages> = {
  en: {
    projectTitle: "Select a project folder",
    exportTitle: "Export MCPMender report",
    helpTitle: "MCPMender Tutorial & Help"
  },
  "zh-CN": {
    projectTitle: "选择项目文件夹",
    exportTitle: "导出 MCPMender 脱敏报告",
    helpTitle: "MCPMender 教程与帮助"
  },
  ja: {
    projectTitle: "プロジェクトフォルダーを選択",
    exportTitle: "MCPMender 匿名化レポートを書き出す",
    helpTitle: "MCPMender チュートリアルとヘルプ"
  }
};

function normalizeDesktopLocale(value: unknown): DesktopLocale {
  if (value === "zh-CN" || value === "ja") return value;
  return "en";
}

function rendererReport(report: ScanReport): ScanReport {
  // Keep the trusted, unredacted snapshot in the main process for hash-checked
  // repairs. The renderer only needs a safe presentation copy.
  const safeReport = redactReport(report);
  safeReport.repairs = safeReport.repairs.map((repair, index) => ({
    ...repair,
    id: opaqueRepairId(report, report.repairs[index])
  }));
  return safeReport;
}

function opaqueRepairId(
  report: ScanReport,
  repair: ScanReport["repairs"][number]
): string {
  return sha256(
    `${report.generatedAt}\u0000${repair.id}\u0000${repair.configPath}`
  );
}

function rendererRepairBatch(
  result: RepairBatchResult,
  report: ScanReport
): RepairBatchResult {
  const safeResult = redactReport(result);
  const opaqueIds = new Map(
    report.repairs.map((repair) => [
      repair.id,
      opaqueRepairId(report, repair)
    ])
  );
  safeResult.results = safeResult.results.map((item) => ({
    ...item,
    repairId:
      opaqueIds.get(item.repairId) ??
      sha256(`${report.generatedAt}\u0000${item.repairId}`)
  }));
  return safeResult;
}

async function writeJsonAtomically(
  targetPath: string,
  value: unknown
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function canWriteDirectory(directory: string): boolean {
  try {
    mkdirSync(directory, { recursive: true });
    accessSync(directory, constants.W_OK);
    const marker = path.join(
      directory,
      `.mcpmender-write-test-${process.pid}-${randomUUID()}`
    );
    writeFileSync(marker, "");
    rmSync(marker, { force: true });
    return true;
  } catch {
    return false;
  }
}

function configureStorage(): StorageInfo {
  const requestedDir = process.env.MCPMENDER_DATA_DIR?.trim();
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR?.trim();
  const adjacentDir = portableDir
    ? path.join(portableDir, "data")
    : app.isPackaged
      ? path.join(path.dirname(app.getPath("exe")), "data")
      : undefined;
  const fallbackDir = path.join(app.getPath("userData"), "data");
  const candidates = [
    requestedDir
      ? { dataDir: path.resolve(requestedDir), portable: true, fallback: false }
      : undefined,
    adjacentDir
      ? { dataDir: adjacentDir, portable: true, fallback: false }
      : undefined,
    { dataDir: fallbackDir, portable: false, fallback: true }
  ].filter((candidate): candidate is StorageInfo => Boolean(candidate));
  const selected =
    candidates.find((candidate) => canWriteDirectory(candidate.dataDir)) ??
    candidates[candidates.length - 1];

  for (const [name, subdirectory] of [
    ["userData", "user-data"],
    ["sessionData", "session-data"],
    ["cache", "cache"],
    ["crashDumps", "crash-dumps"],
    ["logs", "logs"]
  ] as const) {
    const target = path.join(selected.dataDir, subdirectory);
    mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  return selected;
}

const storageInfo = configureStorage();
const backupRoot = path.join(storageInfo.dataDir, "backups");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function desktopScanOptions(): {
  projectDir?: string;
  skipProjectConfigs: boolean;
} {
  return {
    projectDir: selectedProjectDir,
    skipProjectConfigs: !selectedProjectDir
  };
}

async function performScan(): Promise<ScanReport> {
  pendingProbeSnapshot = undefined;
  lastScanReport = await scanMcpConfigurations(desktopScanOptions());
  return rendererReport(lastScanReport);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function historyFilePath(transactionId: string): string {
  return path.join(backupRoot, transactionId, "desktop-history.json");
}

async function saveRepairHistory(
  transactionId: string,
  createdAt: string,
  results: Awaited<ReturnType<typeof applySafeRepairs>>["results"]
): Promise<void> {
  const unique = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    if (result.applied && result.backupPath) {
      unique.set(`${result.backupPath}\0${result.configPath}`, result);
    }
  }
  const entries: RollbackHistoryEntry[] = [];
  for (const result of unique.values()) {
    const backupPath = result.backupPath!;
    if (!isPathInside(backupRoot, backupPath)) {
      throw new Error("REPAIR_BACKUP_OUTSIDE_STORAGE");
    }
    const repair = lastScanReport?.repairs.find(
      (candidate) => candidate.id === result.repairId
    );
    const [backupBytes, repairedBytes] = await Promise.all([
      readFile(backupPath),
      readFile(result.configPath)
    ]);
    entries.push({
      id: randomUUID(),
      transactionId,
      createdAt,
      clientName: repair?.clientName ?? "MCP client",
      configPath: result.configPath,
      backupPath,
      backupHash: sha256(backupBytes),
      repairedHash: sha256(repairedBytes)
    });
  }
  if (entries.length === 0) return;
  const history: RollbackHistoryFile = {
    schemaVersion: 1,
    transactionId,
    createdAt,
    entries
  };
  await writeJsonAtomically(historyFilePath(transactionId), history);
}

async function readRollbackHistory(): Promise<
  Array<RollbackHistoryEntry & { historyPath: string }>
> {
  await mkdir(backupRoot, { recursive: true });
  const directories = await readdir(backupRoot, { withFileTypes: true });
  const entries: Array<RollbackHistoryEntry & { historyPath: string }> = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const historyPath = historyFilePath(directory.name);
    try {
      const parsed = JSON.parse(
        await readFile(historyPath, "utf8")
      ) as RollbackHistoryFile;
      if (
        parsed.schemaVersion !== 1 ||
        parsed.transactionId !== directory.name ||
        !Array.isArray(parsed.entries)
      ) {
        continue;
      }
      for (const entry of parsed.entries) {
        if (
          typeof entry.id === "string" &&
          typeof entry.configPath === "string" &&
          typeof entry.backupPath === "string" &&
          isPathInside(backupRoot, entry.backupPath)
        ) {
          entries.push({ ...entry, historyPath });
        }
      }
    } catch {
      // Ignore incomplete or legacy transactions that have no desktop history.
    }
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function rollbackHistoryEntry(
  entryId: string
): Promise<{ historyWarning?: "ROLLBACK_HISTORY_SAVE_FAILED" }> {
  const entries = await readRollbackHistory();
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry || entry.rolledBackAt) throw new Error("ROLLBACK_NOT_AVAILABLE");
  if (!isPathInside(backupRoot, entry.backupPath)) {
    throw new Error("ROLLBACK_INVALID_BACKUP_PATH");
  }
  await Promise.all([access(entry.backupPath), access(entry.configPath)]);
  const [backupBytes, currentBytes] = await Promise.all([
    readFile(entry.backupPath),
    readFile(entry.configPath)
  ]);
  if (sha256(backupBytes) !== entry.backupHash) {
    throw new Error("ROLLBACK_BACKUP_CHANGED");
  }
  if (sha256(currentBytes) !== entry.repairedHash) {
    throw new Error("ROLLBACK_CONFIG_CHANGED");
  }
  await rollbackRepair(entry.backupPath, entry.configPath, {
    expectedCurrentHash: entry.repairedHash
  });
  try {
    const history = JSON.parse(
      await readFile(entry.historyPath, "utf8")
    ) as RollbackHistoryFile;
    const persisted = history.entries.find(
      (candidate) => candidate.id === entry.id
    );
    if (persisted) persisted.rolledBackAt = new Date().toISOString();
    await writeJsonAtomically(entry.historyPath, history);
    return {};
  } catch (error) {
    console.error(
      "MCPMender restored a configuration but could not update rollback history.",
      error
    );
    return { historyWarning: "ROLLBACK_HISTORY_SAVE_FAILED" };
  }
}

function probeSummary(results: ProbeResult[]): ProbeReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    results,
    summary: {
      total: results.length,
      connected: results.filter((result) => result.status === "connected")
        .length,
      authRequired: results.filter(
        (result) => result.status === "auth-required"
      ).length,
      failed: results.filter(
        (result) => !["connected", "auth-required"].includes(result.status)
      ).length
    }
  };
}

async function runProbeWithProgress(
  event: IpcMainInvokeEvent
): Promise<ProbeReport> {
  if (activeProbe) throw new Error("PROBE_ALREADY_RUNNING");
  const controller = new AbortController();
  activeProbe = { controller, senderId: event.sender.id };
  try {
    const targets = pendingProbeSnapshot;
    if (!targets) throw new Error("PROBE_PREVIEW_REQUIRED");
    if (controller.signal.aborted) throw new Error("PROBE_CANCELLED");
    const grouped = new Map<string, typeof targets>();
    for (const target of targets) {
      const selector = `${target.clientId}/${target.server.name}`;
      const existing = grouped.get(selector) ?? [];
      existing.push(target);
      grouped.set(selector, existing);
    }
    const work = [...grouped.entries()];
    const results: ProbeResult[] = [];
    let nextIndex = 0;
    let completed = 0;
    const emitProgress = (current?: string): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("mcpmender:probe-progress", {
          completed,
          total: targets.length,
          current
        });
      }
    };
    emitProgress();
    await Promise.all(
      Array.from({ length: Math.min(2, work.length) }, async () => {
        while (!controller.signal.aborted && nextIndex < work.length) {
          const [selector, targetGroup] = work[nextIndex++];
          emitProgress(
            targetGroup
              .map((target) => `${target.clientName} / ${target.server.name}`)
              .join(", ")
          );
          const report = await probeMcpTargets(targetGroup, {
            timeoutMs: 8_000,
            concurrency: 2,
            signal: controller.signal,
            platform: process.platform
          });
          results.push(...report.results);
          completed += report.results.length;
          emitProgress();
        }
      })
    );
    if (controller.signal.aborted) throw new Error("PROBE_CANCELLED");
    return probeSummary(results);
  } finally {
    activeProbe = undefined;
    pendingProbeSnapshot = undefined;
    if (quitAfterProbe) {
      quitAfterProbe = false;
      if (forceQuitTimer) clearTimeout(forceQuitTimer);
      forceQuitTimer = undefined;
      setImmediate(() => app.quit());
    }
  }
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

function hardenWindow(window: BrowserWindow): void {
  const allowedRoot = pathToFileURL(`${__dirname}${path.sep}`).href;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(allowedRoot)) event.preventDefault();
  });
}

function openHelpWindow(locale: DesktopLocale = "en"): void {
  if (helpWindow && !helpWindow.isDestroyed()) {
    if (helpWindowLocale !== locale) {
      helpWindowLocale = locale;
      void helpWindow.loadFile(
        path.join(__dirname, "MCPMender-Handbook.html"),
        { query: { lang: locale } }
      );
    }
    helpWindow.focus();
    return;
  }
  helpWindowLocale = locale;

  helpWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#08111e",
    title: desktopDialogMessages[locale].helpTitle,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      webSecurity: true
    }
  });
  hardenWindow(helpWindow);
  helpWindow.setMenuBarVisibility(false);
  void helpWindow
    .loadFile(path.join(__dirname, "MCPMender-Handbook.html"), {
      query: { lang: locale }
    })
    .catch(async (error) => {
      console.error("Unable to load the packaged MCPMender handbook.", error);
      const failedWindow = helpWindow;
      helpWindow = undefined;
      failedWindow?.destroy();
      if (!process.env.MCPMENDER_CAPTURE_PATH && mainWindow) {
        await dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "MCPMender",
          message: "MCPMender could not load its local tutorial.",
          detail: String(error)
        });
      }
    });
  helpWindow.once("ready-to-show", () => helpWindow?.show());
  helpWindow.on("closed", () => {
    helpWindow = undefined;
  });
}

async function waitForHelpWindow(timeoutMs = 5_000): Promise<BrowserWindow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      helpWindow &&
      !helpWindow.isDestroyed() &&
      !helpWindow.webContents.isLoadingMainFrame()
    ) {
      return helpWindow;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The real tutorial window did not finish loading.");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 640,
    minHeight: 500,
    show: false,
    backgroundColor: "#09111f",
    icon: path.join(__dirname, "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#09111f",
      symbolColor: "#dce8ff",
      height: 42
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      webSecurity: true
    }
  });
  hardenWindow(mainWindow);

  const initialPage = "index.html";
  const captureLocale = process.env.MCPMENDER_CAPTURE_LOCALE;
  const initialLoadOptions =
    captureLocale === "en" ||
    captureLocale === "zh-CN" ||
    captureLocale === "ja"
      ? { query: { lang: captureLocale } }
      : undefined;
  void mainWindow.loadFile(path.join(__dirname, initialPage), initialLoadOptions).catch(async (error) => {
    console.error(`Unable to load the packaged renderer '${initialPage}'.`, error);
    if (!process.env.MCPMENDER_CAPTURE_PATH) {
      await dialog.showMessageBox(mainWindow!, {
        type: "error",
        title: "MCPMender",
        message: "MCPMender could not load its local interface.",
        detail: String(error)
      });
    }
    app.exit(70);
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    const capturePath = process.env.MCPMENDER_CAPTURE_PATH;
    if (capturePath) {
      setTimeout(async () => {
        try {
          const captureTarget =
            process.env.MCPMENDER_CAPTURE_TARGET === "help" ? "help" : "main";
          let captureWindow = mainWindow;
          if (captureTarget === "help") {
            await mainWindow?.webContents.executeJavaScript(
              "document.querySelector('#help-button')?.click()",
              true
            );
            captureWindow = await waitForHelpWindow();
          }
          const expectedSelector =
            captureTarget === "help" ? "#content h1" : "#scan-button";
          const rendererReady = await captureWindow?.webContents.executeJavaScript(
            `Boolean(document.querySelector(${JSON.stringify(expectedSelector)}))`,
            true
          );
          if (!rendererReady) {
            throw new Error(
              `Packaged renderer did not expose ${expectedSelector}.`
            );
          }
          const image = await captureWindow?.webContents.capturePage();
          if (!image || image.isEmpty()) {
            throw new Error("Packaged renderer produced an empty capture.");
          }
          await writeFile(capturePath, image.toPNG());
          app.quit();
        } catch (error) {
          console.error("MCPMender UI smoke capture failed.", error);
          app.exit(70);
        }
      }, 1200);
    }
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  ipcMain.handle("mcpmender:scan", (event) => {
    assertTrustedRenderer(event);
    return performScan();
  });
  ipcMain.handle("mcpmender:select-project", async (event, locale: unknown) => {
    assertTrustedRenderer(event);
    const result = await dialog.showOpenDialog({
      title: desktopDialogMessages[normalizeDesktopLocale(locale)].projectTitle,
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { path: selectedProjectDir };
    }
    selectedProjectDir = result.filePaths[0];
    return {
      path: selectedProjectDir,
      report: await performScan()
    };
  });
  ipcMain.handle("mcpmender:probe-plan", async (event) => {
    assertTrustedRenderer(event);
    pendingProbeSnapshot = await loadProbeTargets(desktopScanOptions());
    return previewProbeTargets(pendingProbeSnapshot);
  });
  ipcMain.handle("mcpmender:probe-run", (event) => {
    assertTrustedRenderer(event);
    return runProbeWithProgress(event);
  });
  ipcMain.handle("mcpmender:probe-cancel", (event) => {
    assertTrustedRenderer(event);
    if (activeProbe?.senderId === event.sender.id) {
      activeProbe.controller.abort();
      return { canceled: true };
    }
    return { canceled: false };
  });
  ipcMain.handle(
    "mcpmender:repair-safe",
    async (event, repairIds: unknown) => {
      assertTrustedRenderer(event);
      if (
        !Array.isArray(repairIds) ||
        repairIds.length === 0 ||
        repairIds.length > 256 ||
        repairIds.some((id) => typeof id !== "string") ||
        !lastScanReport
      ) {
        throw new Error("Invalid repair selection.");
      }
      const selected = new Set(repairIds);
      const trustedReport = lastScanReport;
      const repairs = trustedReport.repairs.filter((repair) =>
        selected.has(opaqueRepairId(trustedReport, repair))
      );
      if (repairs.length !== selected.size) {
        throw new Error("Repair selection is stale or unknown.");
      }
      const createdAt = new Date().toISOString();
      const result = await applySafeRepairs(repairs, { backupRoot });
      const safeResult = rendererRepairBatch(result, trustedReport);
      try {
        await saveRepairHistory(result.transactionId, createdAt, result.results);
        return safeResult;
      } catch (error) {
        console.error(
          "MCPMender applied one or more repairs but could not save desktop rollback history.",
          error
        );
        return {
          ...safeResult,
          historyWarning: "REPAIR_HISTORY_SAVE_FAILED" as const
        };
      }
    }
  );
  ipcMain.handle("mcpmender:export-report", async (event, locale: unknown) => {
    assertTrustedRenderer(event);
    const report = lastScanReport ?? (await performScan());
    const result = await dialog.showSaveDialog({
      title: desktopDialogMessages[normalizeDesktopLocale(locale)].exportTitle,
      defaultPath: `mcpmender-report-${new Date()
        .toISOString()
        .slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(
      result.filePath,
      JSON.stringify(redactReport(report, os.homedir()), null, 2),
      "utf8"
    );
    return { saved: true, path: result.filePath };
  });
  ipcMain.handle("mcpmender:open-help", (event, locale: unknown) => {
    assertTrustedRenderer(event);
    openHelpWindow(normalizeDesktopLocale(locale));
  });
  ipcMain.handle("mcpmender:storage-info", (event) => {
    assertTrustedRenderer(event);
    return storageInfo;
  });
  ipcMain.handle("mcpmender:rollback-list", async (event) => {
    assertTrustedRenderer(event);
    return (await readRollbackHistory()).map(
      ({ historyPath: _historyPath, backupPath: _backupPath, ...entry }) => entry
    );
  });
  ipcMain.handle(
    "mcpmender:rollback-run",
    async (event, entryId: unknown) => {
      assertTrustedRenderer(event);
      if (typeof entryId !== "string" || entryId.length > 128) {
        throw new Error("ROLLBACK_INVALID_SELECTION");
      }
      const outcome = await rollbackHistoryEntry(entryId);
      try {
        return {
          ...outcome,
          report: await performScan()
        };
      } catch (error) {
        console.error(
          "MCPMender restored a configuration but could not refresh the scan.",
          error
        );
        return {
          ...outcome,
          scanWarning: "ROLLBACK_RESCAN_FAILED" as const
        };
      }
    }
  );
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!activeProbe) return;
  event.preventDefault();
  if (quitAfterProbe) return;
  quitAfterProbe = true;
  activeProbe.controller.abort();
  forceQuitTimer = setTimeout(() => {
    console.error("MCPMender forced shutdown after probe cleanup timed out.");
    app.exit(0);
  }, 12_000);
  forceQuitTimer.unref();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
