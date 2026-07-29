import type {
  RepairAction,
  RepairBatchResult,
  ScanReport
} from "@mcpulse/core";

declare global {
  interface Window {
    mcpulse: {
      scan(): Promise<ScanReport>;
      repairSafe(repairs: RepairAction[]): Promise<RepairBatchResult>;
      exportReport(
        report: ScanReport
      ): Promise<{ saved: boolean; path?: string }>;
      openHelp(): Promise<void>;
    };
  }
}

export {};
