export type Locale = "en" | "zh-CN" | "ja";

export type ClientId =
  | "codex"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "gemini"
  | "opencode";

export type FindingSeverity = "info" | "warning" | "error";
export type RepairRisk = "safe" | "review" | "manual";

export interface ConfigCandidate {
  clientId: ClientId;
  displayName: string;
  path: string;
  format: "jsonc" | "toml";
}
export interface ServerDefinition {
  name: string;
  command?: string;
  args: string[];
  url?: string;
  cwd?: string;
  env?: Record<string, string>;
  envKeys?: string[];
  headers?: Record<string, string>;
  hasHeaders?: boolean;
}

export type ProbeTransport = "stdio" | "http";
export type ProbeStatus =
  | "connected"
  | "auth-required"
  | "not-found"
  | "timeout"
  | "failed"
  | "unsupported";

export interface ProbeTarget {
  clientId: ClientId;
  clientName: string;
  configPath: string;
  server: ServerDefinition;
}

export interface ProbeResult {
  clientId: ClientId;
  clientName: string;
  configPath: string;
  serverName: string;
  transport: ProbeTransport;
  status: ProbeStatus;
  durationMs: number;
  protocolVersion?: string;
  serverNameReported?: string;
  serverVersion?: string;
  toolCount?: number;
  messageKey: string;
  detail?: string;
}

export interface ProbeReport {
  schemaVersion: 1;
  generatedAt: string;
  platform: NodeJS.Platform;
  results: ProbeResult[];
  summary: {
    total: number;
    connected: number;
    authRequired: number;
    failed: number;
  };
}

export interface ProbeOptions {
  timeoutMs?: number;
  concurrency?: number;
  scanOptions?: Omit<ScanOptions, "includeSensitive">;
  serverNames?: string[];
}

export interface RepairAction {
  id: string;
  clientId: ClientId;
  clientName: string;
  configPath: string;
  serverName: string;
  risk: RepairRisk;
  kind: "wrap-windows-npx";
  titleKey: string;
  detailKey: string;
  before: {
    command: string;
    args: string[];
  };
  after: {
    command: string;
    args: string[];
  };
  expectedHash: string;
}

export interface Finding {
  id: string;
  clientId: ClientId;
  clientName: string;
  configPath: string;
  serverName?: string;
  severity: FindingSeverity;
  titleKey: string;
  detailKey: string;
  detailParams?: Record<string, string | number>;
  repairId?: string;
}

export interface ClientScanResult {
  clientId: ClientId;
  displayName: string;
  configPath: string;
  installed: boolean;
  configFound: boolean;
  parseable: boolean;
  serverCount: number;
  servers: ServerDefinition[];
  findings: Finding[];
}

export interface ScanReport {
  schemaVersion: 1;
  generatedAt: string;
  platform: NodeJS.Platform;
  clients: ClientScanResult[];
  findings: Finding[];
  repairs: RepairAction[];
  summary: {
    detectedClients: number;
    configuredServers: number;
    errors: number;
    warnings: number;
    safeRepairs: number;
  };
}

export interface ScanOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  appDataDir?: string;
  projectDir?: string;
  candidates?: ConfigCandidate[];
  includeSensitive?: boolean;
  skipProjectConfigs?: boolean;
}

export interface RepairResult {
  repairId: string;
  applied: boolean;
  backupPath?: string;
  configPath: string;
  messageKey: string;
}

export interface RepairBatchResult {
  transactionId: string;
  results: RepairResult[];
}
