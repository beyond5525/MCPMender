import type { Locale } from "./types.js";

type TranslationParams = Record<string, string | number>;

const messages = {
  en: {
    "app.name": "MCPulse",
    "app.tagline": "Local MCP diagnostics and safe repair",
    "action.scan": "Scan now",
    "action.scanning": "Scanning…",
    "action.repairSafe": "Repair safe issues",
    "action.export": "Export redacted report",
    "action.help": "Tutorial & help",
    "action.details": "View details",
    "action.confirmRepair": "Back up and repair",
    "action.cancel": "Cancel",
    "action.close": "Close",
    "action.retry": "Scan again",
    "action.rollback": "Rollback",
    "language.label": "Language",
    "language.en": "English",
    "language.zh-CN": "简体中文",
    "language.ja": "日本語",
    "status.healthy": "Healthy",
    "status.warning": "Needs attention",
    "status.error": "Problem found",
    "status.notConfigured": "Not configured",
    "status.configuredServers": "{count} MCP server(s)",
    "summary.clients": "AI tools found",
    "summary.servers": "Configured MCP servers",
    "summary.problems": "Problems",
    "summary.safeRepairs": "Safe repairs",
    "empty.title": "No MCP configurations found",
    "empty.detail": "Install or configure an AI developer tool, then scan again.",
    "privacy.localOnly": "Local only · no telemetry · secrets redacted",
    "repair.previewTitle": "Repair preview",
    "repair.previewDetail": "MCPulse will back up the original configuration before applying these low-risk changes.",
    "repair.before": "Before",
    "repair.after": "After",
    "repair.complete": "Repair completed and the original configuration was backed up.",
    "report.saved": "Redacted report saved.",
    "scan.configMissing.title": "No MCP configuration found",
    "scan.configMissing.detail": "MCPulse checked {path}. Nothing will be created automatically.",
    "scan.parseError.title": "Configuration cannot be read",
    "scan.parseError.detail": "The configuration contains invalid syntax. MCPulse will not modify it automatically.",
    "scan.serverInvalid.title": "Incomplete MCP server configuration",
    "scan.serverInvalid.detail": "Server {server} has neither a command nor a URL.",
    "scan.windowsNpx.title": "Windows may not start npx directly",
    "scan.windowsNpx.detail": "Server {server} uses npx directly. Some Windows MCP hosts require cmd /c.",
    "scan.ok.title": "Configuration looks valid",
    "scan.ok.detail": "Static checks found no known problems.",
    "repair.windowsNpx.title": "Use the Windows command wrapper",
    "repair.windowsNpx.detail": "Change npx to cmd /d /s /c npx while preserving all existing arguments.",
    "repair.applied": "Repair applied.",
    "repair.skippedChanged": "Skipped because the configuration changed after the scan.",
    "repair.failed": "Repair failed; the original file was preserved."
  },
  "zh-CN": {
    "app.name": "MCPulse",
    "app.tagline": "本地 MCP 检测与安全修复中心",
    "action.scan": "立即检测",
    "action.scanning": "正在检测…",
    "action.repairSafe": "一键修复安全问题",
    "action.export": "导出脱敏报告",
    "action.help": "教程与帮助",
    "action.details": "查看详情",
    "action.confirmRepair": "备份并修复",
    "action.cancel": "取消",
    "action.close": "关闭",
    "action.retry": "重新检测",
    "action.rollback": "撤销修复",
    "language.label": "语言",
    "language.en": "English",
    "language.zh-CN": "简体中文",
    "language.ja": "日本語",
    "status.healthy": "正常",
    "status.warning": "需要关注",
    "status.error": "发现问题",
    "status.notConfigured": "尚未配置",
    "status.configuredServers": "{count} 个 MCP 服务",
    "summary.clients": "发现的 AI 工具",
    "summary.servers": "已配置 MCP 服务",
    "summary.problems": "问题",
    "summary.safeRepairs": "可安全修复",
    "empty.title": "没有找到 MCP 配置",
    "empty.detail": "安装或配置 AI 开发工具后重新检测。",
    "privacy.localOnly": "完全本地 · 无遥测 · 自动隐藏敏感信息",
    "repair.previewTitle": "修复预览",
    "repair.previewDetail": "MCPulse 会先备份原配置，再应用这些低风险修改。",
    "repair.before": "修改前",
    "repair.after": "修改后",
    "repair.complete": "修复完成，原配置已备份。",
    "report.saved": "脱敏报告已保存。",
    "scan.configMissing.title": "没有找到 MCP 配置",
    "scan.configMissing.detail": "已检查 {path}，MCPulse 不会擅自创建配置。",
    "scan.parseError.title": "无法读取配置",
    "scan.parseError.detail": "配置包含无效语法，MCPulse 不会自动修改。",
    "scan.serverInvalid.title": "MCP 服务配置不完整",
    "scan.serverInvalid.detail": "服务 {server} 既没有启动命令，也没有 URL。",
    "scan.windowsNpx.title": "Windows 可能无法直接启动 npx",
    "scan.windowsNpx.detail": "服务 {server} 直接使用 npx，部分 Windows MCP 客户端需要 cmd /c。",
    "scan.ok.title": "配置检查正常",
    "scan.ok.detail": "静态检查没有发现已知问题。",
    "repair.windowsNpx.title": "使用 Windows 命令包装器",
    "repair.windowsNpx.detail": "将 npx 改为 cmd /d /s /c npx，并保留全部现有参数。",
    "repair.applied": "修复已应用。",
    "repair.skippedChanged": "检测后配置发生变化，为保护用户修改，本次已跳过。",
    "repair.failed": "修复失败，原文件未被替换。"
  },
  ja: {
    "app.name": "MCPulse",
    "app.tagline": "ローカル MCP 診断と安全な修復",
    "action.scan": "今すぐ診断",
    "action.scanning": "診断中…",
    "action.repairSafe": "安全な問題を一括修復",
    "action.export": "匿名化レポートを書き出す",
    "action.help": "チュートリアルとヘルプ",
    "action.details": "詳細を見る",
    "action.confirmRepair": "バックアップして修復",
    "action.cancel": "キャンセル",
    "action.close": "閉じる",
    "action.retry": "再診断",
    "action.rollback": "元に戻す",
    "language.label": "言語",
    "language.en": "English",
    "language.zh-CN": "简体中文",
    "language.ja": "日本語",
    "status.healthy": "正常",
    "status.warning": "確認が必要",
    "status.error": "問題あり",
    "status.notConfigured": "未設定",
    "status.configuredServers": "{count} 個の MCP サーバー",
    "summary.clients": "検出した AI ツール",
    "summary.servers": "設定済み MCP サーバー",
    "summary.problems": "問題",
    "summary.safeRepairs": "安全に修復可能",
    "empty.title": "MCP 設定が見つかりません",
    "empty.detail": "AI 開発ツールを設定してから、もう一度診断してください。",
    "privacy.localOnly": "ローカル処理のみ · テレメトリなし · 秘密情報を匿名化",
    "repair.previewTitle": "修復内容の確認",
    "repair.previewDetail": "低リスクの変更を適用する前に、元の設定をバックアップします。",
    "repair.before": "変更前",
    "repair.after": "変更後",
    "repair.complete": "修復が完了し、元の設定をバックアップしました。",
    "report.saved": "匿名化レポートを保存しました。",
    "scan.configMissing.title": "MCP 設定がありません",
    "scan.configMissing.detail": "{path} を確認しました。設定を自動作成することはありません。",
    "scan.parseError.title": "設定を読み取れません",
    "scan.parseError.detail": "設定の構文が不正です。MCPulse は自動変更しません。",
    "scan.serverInvalid.title": "MCP サーバー設定が不完全です",
    "scan.serverInvalid.detail": "サーバー {server} にコマンドも URL もありません。",
    "scan.windowsNpx.title": "Windows で npx を直接起動できない可能性があります",
    "scan.windowsNpx.detail": "サーバー {server} は npx を直接使用しています。一部の Windows MCP ホストでは cmd /c が必要です。",
    "scan.ok.title": "設定に問題はありません",
    "scan.ok.detail": "静的診断で既知の問題は見つかりませんでした。",
    "repair.windowsNpx.title": "Windows コマンドラッパーを使用",
    "repair.windowsNpx.detail": "既存の引数を維持したまま、npx を cmd /d /s /c npx に変更します。",
    "repair.applied": "修復を適用しました。",
    "repair.skippedChanged": "診断後に設定が変更されたため、安全のためスキップしました。",
    "repair.failed": "修復に失敗しました。元のファイルは保持されています。"
  }
} as const;

export type TranslationKey = keyof (typeof messages)["en"];

export function normalizeLocale(input?: string): Locale {
  const value = (input ?? "").toLowerCase();
  if (value.startsWith("zh")) return "zh-CN";
  if (value.startsWith("ja")) return "ja";
  return "en";
}

export function translate(
  locale: Locale,
  key: string,
  params: TranslationParams = {}
): string {
  const dictionary = messages[locale] as Record<string, string>;
  const fallback = messages.en as Record<string, string>;
  const template = dictionary[key] ?? fallback[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params[name] === undefined ? `{${name}}` : String(params[name])
  );
}

export function supportedLocales(): Locale[] {
  return ["en", "zh-CN", "ja"];
}
