import { contextBridge, ipcRenderer } from "electron";
import type {
  RepairAction,
  RepairBatchResult,
  ProbeReport,
  ProbeTarget,
  ScanReport
} from "@mcpulse/core";

contextBridge.exposeInMainWorld("mcpulse", {
  scan: (): Promise<ScanReport> => ipcRenderer.invoke("mcpulse:scan"),
  selectProject: (): Promise<{ path?: string; report?: ScanReport }> =>
    ipcRenderer.invoke("mcpulse:select-project"),
  planProbe: (): Promise<ProbeTarget[]> =>
    ipcRenderer.invoke("mcpulse:probe-plan"),
  runProbe: (): Promise<ProbeReport> =>
    ipcRenderer.invoke("mcpulse:probe-run"),
  repairSafe: (repairs: RepairAction[]): Promise<RepairBatchResult> =>
    ipcRenderer.invoke("mcpulse:repair-safe", repairs),
  exportReport: (
    report: ScanReport
  ): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke("mcpulse:export-report", report),
  openHelp: (): Promise<void> => ipcRenderer.invoke("mcpulse:open-help")
});
