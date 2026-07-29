import { writeFile } from "node:fs/promises";
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
  planProbeTargets,
  probeMcpConfigurations,
  redactReport,
  scanMcpConfigurations,
  type ScanReport
} from "@mcpmender/core";

let mainWindow: BrowserWindow | undefined;
let helpWindow: BrowserWindow | undefined;
let selectedProjectDir: string | undefined;
let lastScanReport: ScanReport | undefined;

app.setName("MCPMender");

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
  lastScanReport = await scanMcpConfigurations(desktopScanOptions());
  return lastScanReport;
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

function openHelpWindow(): void {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }

  helpWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    show: false,
    backgroundColor: "#08111e",
    title: "MCPMender Tutorial & Help",
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
  void helpWindow.loadFile(path.join(__dirname, "MCPMender-Handbook.html"));
  helpWindow.once("ready-to-show", () => helpWindow?.show());
  helpWindow.on("closed", () => {
    helpWindow = undefined;
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
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

  const initialPage =
    process.env.MCPMENDER_CAPTURE_TARGET === "help"
      ? "MCPMender-Handbook.html"
      : "index.html";
  void mainWindow.loadFile(path.join(__dirname, initialPage));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    const capturePath = process.env.MCPMENDER_CAPTURE_PATH;
    if (capturePath) {
      setTimeout(async () => {
        const image = await mainWindow?.webContents.capturePage();
        if (image) await writeFile(capturePath, image.toPNG());
        app.quit();
      }, 1200);
    }
  });
}

app.whenReady().then(() => {
  ipcMain.handle("mcpmender:scan", (event) => {
    assertTrustedRenderer(event);
    return performScan();
  });
  ipcMain.handle("mcpmender:select-project", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showOpenDialog({
      title: "Select a project folder",
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
  ipcMain.handle("mcpmender:probe-plan", (event) => {
    assertTrustedRenderer(event);
    return planProbeTargets(desktopScanOptions());
  });
  ipcMain.handle("mcpmender:probe-run", (event) => {
    assertTrustedRenderer(event);
    return probeMcpConfigurations({
      timeoutMs: 8_000,
      concurrency: 2,
      scanOptions: desktopScanOptions()
    });
  });
  ipcMain.handle(
    "mcpmender:repair-safe",
    async (event, repairIds: unknown) => {
      assertTrustedRenderer(event);
      if (
        !Array.isArray(repairIds) ||
        repairIds.length > 256 ||
        repairIds.some((id) => typeof id !== "string")
      ) {
        throw new Error("Invalid repair selection.");
      }
      const selected = new Set(repairIds);
      const repairs = (lastScanReport?.repairs ?? []).filter((repair) =>
        selected.has(repair.id)
      );
      if (repairs.length !== selected.size) {
        throw new Error("Repair selection is stale or unknown.");
      }
      return applySafeRepairs(repairs);
    }
  );
  ipcMain.handle("mcpmender:export-report", async (event) => {
    assertTrustedRenderer(event);
    const report = lastScanReport ?? (await performScan());
    const result = await dialog.showSaveDialog({
      title: "Export MCPMender report",
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
  ipcMain.handle("mcpmender:open-help", (event) => {
    assertTrustedRenderer(event);
    openHelpWindow();
  });
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
