import type {
  RepairBatchResult,
  ProbeReport,
  ProbeTarget,
  ScanReport
} from "@mcpmender/core";

declare global {
  interface Window {
    mcpmender: {
      scan(): Promise<ScanReport>;
      selectProject(): Promise<{ path?: string; report?: ScanReport }>;
      planProbe(): Promise<ProbeTarget[]>;
      runProbe(): Promise<ProbeReport>;
      repairSafe(repairIds: string[]): Promise<RepairBatchResult>;
      exportReport(): Promise<{ saved: boolean; path?: string }>;
      openHelp(): Promise<void>;
    };
  }
}

export {};
