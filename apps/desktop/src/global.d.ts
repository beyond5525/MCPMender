import type {
  RepairAction,
  RepairBatchResult,
  ProbeReport,
  ProbeTarget,
  ScanReport
} from "@mcpulse/core";

declare global {
  interface Window {
    mcpulse: {
      scan(): Promise<ScanReport>;
      selectProject(): Promise<{ path?: string; report?: ScanReport }>;
      planProbe(): Promise<ProbeTarget[]>;
      runProbe(): Promise<ProbeReport>;
      repairSafe(repairs: RepairAction[]): Promise<RepairBatchResult>;
      exportReport(
        report: ScanReport
      ): Promise<{ saved: boolean; path?: string }>;
      openHelp(): Promise<void>;
    };
  }
}

export {};
