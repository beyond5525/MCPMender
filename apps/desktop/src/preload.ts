import { contextBridge, ipcRenderer } from "electron";
import type {
  RepairAction,
  RepairBatchResult,
  ScanReport
} from "@mcpulse/core";

contextBridge.exposeInMainWorld("mcpulse", {
  scan: (): Promise<ScanReport> => ipcRenderer.invoke("mcpulse:scan"),
  repairSafe: (repairs: RepairAction[]): Promise<RepairBatchResult> =>
    ipcRenderer.invoke("mcpulse:repair-safe", repairs),
  exportReport: (
    report: ScanReport
  ): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke("mcpulse:export-report", report),
  openHelp: (): Promise<void> => ipcRenderer.invoke("mcpulse:open-help")
});
