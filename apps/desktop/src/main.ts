import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  applySafeRepairs,
  planProbeTargets,
  probeMcpConfigurations,
  redactReport,
  scanMcpConfigurations,
  type RepairAction
} from "@mcpulse/core";

let mainWindow: BrowserWindow | undefined;
let helpWindow: BrowserWindow | undefined;
let selectedProjectDir: string | undefined;

function desktopScanOptions(): {
  projectDir?: string;
  skipProjectConfigs: boolean;
} {
  return {
    projectDir: selectedProjectDir,
    skipProjectConfigs: !selectedProjectDir
  };
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
    title: "MCPulse Tutorial & Help",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  helpWindow.setMenuBarVisibility(false);
  void helpWindow.loadFile(path.join(__dirname, "MCPulse-Handbook.html"));
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
      nodeIntegration: false
    }
  });

  const initialPage =
    process.env.MCPULSE_CAPTURE_TARGET === "help"
      ? "MCPulse-Handbook.html"
      : "index.html";
  void mainWindow.loadFile(path.join(__dirname, initialPage));
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    const capturePath = process.env.MCPULSE_CAPTURE_PATH;
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
  ipcMain.handle("mcpulse:scan", () =>
    scanMcpConfigurations(desktopScanOptions())
  );
  ipcMain.handle("mcpulse:select-project", async () => {
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
      report: await scanMcpConfigurations(desktopScanOptions())
    };
  });
  ipcMain.handle("mcpulse:probe-plan", () =>
    planProbeTargets(desktopScanOptions())
  );
  ipcMain.handle("mcpulse:probe-run", () =>
    probeMcpConfigurations({
      timeoutMs: 8_000,
      concurrency: 2,
      scanOptions: desktopScanOptions()
    })
  );
  ipcMain.handle(
    "mcpulse:repair-safe",
    (_event, repairs: RepairAction[]) => applySafeRepairs(repairs)
  );
  ipcMain.handle("mcpulse:export-report", async (_event, report) => {
    const result = await dialog.showSaveDialog({
      title: "Export MCPulse report",
      defaultPath: `mcpulse-report-${new Date()
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
  ipcMain.handle("mcpulse:open-help", () => openHelpWindow());
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
