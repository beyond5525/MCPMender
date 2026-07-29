import { contextBridge, ipcRenderer } from "electron";
import type {
  RepairBatchResult,
  ProbeReport,
  ProbeTarget,
  ScanReport
} from "@mcpmender/core";

contextBridge.exposeInMainWorld("mcpmender", {
  scan: (): Promise<ScanReport> => ipcRenderer.invoke("mcpmender:scan"),
  selectProject: (): Promise<{ path?: string; report?: ScanReport }> =>
    ipcRenderer.invoke("mcpmender:select-project"),
  planProbe: (): Promise<ProbeTarget[]> =>
    ipcRenderer.invoke("mcpmender:probe-plan"),
  runProbe: (): Promise<ProbeReport> =>
    ipcRenderer.invoke("mcpmender:probe-run"),
  repairSafe: (repairIds: string[]): Promise<RepairBatchResult> =>
    ipcRenderer.invoke("mcpmender:repair-safe", repairIds),
  exportReport: (): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke("mcpmender:export-report"),
  openHelp: (): Promise<void> => ipcRenderer.invoke("mcpmender:open-help")
});
