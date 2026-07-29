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
  cancelProbe: (): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("mcpmender:probe-cancel"),
  onProbeProgress: (
    callback: (progress: {
      completed: number;
      total: number;
      current?: string;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: { completed: number; total: number; current?: string }
    ): void => callback(progress);
    ipcRenderer.on("mcpmender:probe-progress", listener);
    return () => ipcRenderer.removeListener("mcpmender:probe-progress", listener);
  },
  repairSafe: (repairIds: string[]): Promise<RepairBatchResult> =>
    ipcRenderer.invoke("mcpmender:repair-safe", repairIds),
  exportReport: (): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke("mcpmender:export-report"),
  openHelp: (): Promise<void> => ipcRenderer.invoke("mcpmender:open-help"),
  storageInfo: (): Promise<{
    dataDir: string;
    portable: boolean;
    fallback: boolean;
  }> => ipcRenderer.invoke("mcpmender:storage-info"),
  listRollbacks: (): Promise<
    Array<{
      id: string;
      transactionId: string;
      createdAt: string;
      clientName: string;
      configPath: string;
      backupHash: string;
      repairedHash: string;
      rolledBackAt?: string;
    }>
  > => ipcRenderer.invoke("mcpmender:rollback-list"),
  rollback: (entryId: string): Promise<ScanReport> =>
    ipcRenderer.invoke("mcpmender:rollback-run", entryId)
});
