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
      cancelProbe(): Promise<{ canceled: boolean }>;
      onProbeProgress(
        callback: (progress: {
          completed: number;
          total: number;
          current?: string;
        }) => void
      ): () => void;
      repairSafe(repairIds: string[]): Promise<RepairBatchResult>;
      exportReport(): Promise<{ saved: boolean; path?: string }>;
      openHelp(): Promise<void>;
      storageInfo(): Promise<{
        dataDir: string;
        portable: boolean;
        fallback: boolean;
      }>;
      listRollbacks(): Promise<
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
      >;
      rollback(entryId: string): Promise<ScanReport>;
    };
  }
}

export {};
