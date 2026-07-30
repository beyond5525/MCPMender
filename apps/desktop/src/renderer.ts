import {
  normalizeLocale,
  translate
} from "@mcpmender/core/i18n";
import type {
  ClientScanResult,
  Locale,
  ProbeReport,
  ProbeTarget,
  ScanReport
} from "@mcpmender/core/types";

const startupLocale = new URLSearchParams(window.location.search).get("lang");
let locale: Locale = normalizeLocale(
  startupLocale ??
    localStorage.getItem("mcpmender.locale") ??
    navigator.language
);
if (startupLocale) localStorage.setItem("mcpmender.locale", locale);
let report: ScanReport | undefined;
let toastTimer: number | undefined;
let lastScanAt: Date | undefined;
let isScanning = false;
let isProbing = false;
let isPlanningProbe = false;
let isProbeCanceling = false;
let lastProbeReport: ProbeReport | undefined;
let selectedProjectPath: string | undefined;
let storagePath = "";
let storageFallback = false;
let lastProbeProgress:
  | { completed: number; total: number; current?: string }
  | undefined;

const desktopMessages: Record<Locale, Record<string, string>> = {
  en: {
    "desktop.probeProgress": "Checked {completed}/{total}",
    "desktop.probeCurrent": "Checking: {current}",
    "desktop.probeCancel": "Cancel check",
    "desktop.probeCanceling": "Canceling after active connections close…",
    "desktop.probeCanceled": "Deep connection check canceled safely.",
    "desktop.probeFailed": "Deep connection check failed: {reason}",
    "desktop.scanFailed": "Scan failed: {reason}",
    "desktop.projectFailed": "Could not scan the selected folder: {reason}",
    "desktop.exportFailed": "Could not export the report: {reason}",
    "desktop.repairFailed": "Repair failed: {reason}",
    "desktop.repairPartial":
      "Repair completed for {applied}/{total} item(s). Review skipped or failed items and scan again.",
    "desktop.repairHistoryWarning":
      "The repair was applied, but backup history could not be recorded. Keep the original backup files and rescan before making more changes.",
    "desktop.repairManifestWarning":
      "The repair was applied, but its transaction manifest could not be saved. Keep the backup files.",
    "desktop.repairScanWarning":
      "The repair finished, but verification scan failed. Scan again before another repair.",
    "desktop.rollbackHistory": "Backup history",
    "desktop.rollbackDetail":
      "Restore a configuration only when it has not changed since MCPMender repaired it.",
    "desktop.rollbackEmpty": "No restorable backups are available yet.",
    "desktop.rollbackConfirm":
      "Restore this configuration from the selected backup? Current contents will be replaced only after validation.",
    "desktop.rollbackAction": "Restore backup",
    "desktop.rollbackComplete": "The configuration was restored successfully.",
    "desktop.rollbackUnavailable": "This backup is no longer available.",
    "desktop.rollbackChanged":
      "The configuration changed after repair. Rollback was stopped to protect newer edits.",
    "desktop.rollbackBackupChanged":
      "The backup failed its integrity check and was not used.",
    "desktop.rollbackFailed": "Could not restore the backup: {reason}",
    "desktop.rollbackHistoryWarning":
      "The configuration was restored, but backup history could not be updated.",
    "desktop.rollbackScanWarning":
      "The configuration was restored, but the follow-up scan failed. Scan again before another repair.",
    "desktop.rolledBack": "Already restored",
    "desktop.storagePortable": "Data location: {path}",
    "desktop.storageFallback":
      "Data location fallback: {path} (the application folder was not writable)"
  },
  "zh-CN": {
    "desktop.probeProgress": "已检测 {completed}/{total}",
    "desktop.probeCurrent": "正在检测：{current}",
    "desktop.probeCancel": "取消检测",
    "desktop.probeCanceling": "正在安全关闭当前连接…",
    "desktop.probeCanceled": "已安全取消深度连接检测。",
    "desktop.probeFailed": "深度连接检测失败：{reason}",
    "desktop.scanFailed": "检测失败：{reason}",
    "desktop.projectFailed": "无法检测所选文件夹：{reason}",
    "desktop.exportFailed": "无法导出报告：{reason}",
    "desktop.repairFailed": "修复失败：{reason}",
    "desktop.repairPartial":
      "已完成 {applied}/{total} 项修复。请检查被跳过或失败的项目并重新检测。",
    "desktop.repairHistoryWarning":
      "修复已生效，但无法记录备份历史。请保留原始备份文件，并在继续修改前重新检测。",
    "desktop.repairManifestWarning":
      "修复已生效，但无法保存事务清单。请保留备份文件。",
    "desktop.repairScanWarning":
      "修复已完成，但验证检测失败。请在再次修复前重新检测。",
    "desktop.rollbackHistory": "备份与回滚",
    "desktop.rollbackDetail":
      "只有配置在修复后未被再次修改时，才允许恢复备份。",
    "desktop.rollbackEmpty": "暂时没有可以恢复的备份。",
    "desktop.rollbackConfirm":
      "确定从这个备份恢复配置吗？校验通过后才会替换当前内容。",
    "desktop.rollbackAction": "恢复此备份",
    "desktop.rollbackComplete": "配置已成功恢复。",
    "desktop.rollbackUnavailable": "这个备份已不可用。",
    "desktop.rollbackChanged":
      "修复后配置又发生了变化。为保护较新的修改，已停止回滚。",
    "desktop.rollbackBackupChanged": "备份完整性校验失败，未执行回滚。",
    "desktop.rollbackFailed": "无法恢复备份：{reason}",
    "desktop.rollbackHistoryWarning":
      "配置已恢复，但无法更新备份历史。",
    "desktop.rollbackScanWarning":
      "配置已恢复，但后续检测失败。请在再次修复前手动检测。",
    "desktop.rolledBack": "已恢复",
    "desktop.storagePortable": "数据位置：{path}",
    "desktop.storageFallback":
      "数据备用位置：{path}（应用所在文件夹不可写）"
  },
  ja: {
    "desktop.probeProgress": "{completed}/{total} 件を診断済み",
    "desktop.probeCurrent": "診断中：{current}",
    "desktop.probeCancel": "診断を中止",
    "desktop.probeCanceling": "現在の接続を安全に閉じています…",
    "desktop.probeCanceled": "詳細接続診断を安全に中止しました。",
    "desktop.probeFailed": "詳細接続診断に失敗しました：{reason}",
    "desktop.scanFailed": "診断に失敗しました：{reason}",
    "desktop.projectFailed":
      "選択したフォルダーを診断できませんでした：{reason}",
    "desktop.exportFailed": "レポートを書き出せませんでした：{reason}",
    "desktop.repairFailed": "修復に失敗しました：{reason}",
    "desktop.repairPartial":
      "{applied}/{total} 件を修復しました。スキップまたは失敗した項目を確認して再診断してください。",
    "desktop.repairHistoryWarning":
      "修復は適用されましたが、バックアップ履歴を記録できませんでした。元のバックアップを保管し、次の変更前に再診断してください。",
    "desktop.repairManifestWarning":
      "修復は適用されましたが、トランザクションマニフェストを保存できませんでした。バックアップを保管してください。",
    "desktop.repairScanWarning":
      "修復は完了しましたが、確認診断に失敗しました。次の修復前に再診断してください。",
    "desktop.rollbackHistory": "バックアップ履歴",
    "desktop.rollbackDetail":
      "修復後に変更されていない設定だけをバックアップから復元できます。",
    "desktop.rollbackEmpty": "復元できるバックアップはまだありません。",
    "desktop.rollbackConfirm":
      "選択したバックアップから設定を復元しますか？検証に合格した場合だけ現在の内容を置き換えます。",
    "desktop.rollbackAction": "バックアップを復元",
    "desktop.rollbackComplete": "設定を復元しました。",
    "desktop.rollbackUnavailable": "このバックアップは利用できません。",
    "desktop.rollbackChanged":
      "修復後に設定が変更されています。新しい編集を保護するため復元を中止しました。",
    "desktop.rollbackBackupChanged":
      "バックアップの整合性検証に失敗したため使用しませんでした。",
    "desktop.rollbackFailed": "バックアップを復元できませんでした：{reason}",
    "desktop.rollbackHistoryWarning":
      "設定は復元されましたが、バックアップ履歴を更新できませんでした。",
    "desktop.rollbackScanWarning":
      "設定は復元されましたが、再診断に失敗しました。次の修復前に診断してください。",
    "desktop.rolledBack": "復元済み",
    "desktop.storagePortable": "データ保存先：{path}",
    "desktop.storageFallback":
      "代替データ保存先：{path}（アプリのフォルダーに書き込めません）"
  }
};

const languageSelect = document.querySelector<HTMLSelectElement>("#language-select")!;
const scanButton = document.querySelector<HTMLButtonElement>("#scan-button")!;
const probeButton = document.querySelector<HTMLButtonElement>("#probe-button")!;
const repairButton = document.querySelector<HTMLButtonElement>("#repair-button")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-button")!;
const helpButton = document.querySelector<HTMLButtonElement>("#help-button")!;
const rollbackButton =
  document.querySelector<HTMLButtonElement>("#rollback-button")!;
const scanFeedback = document.querySelector<HTMLElement>("#scan-feedback")!;
const scanStatus = document.querySelector<HTMLElement>("#scan-status")!;
const probeProgress = document.querySelector<HTMLElement>("#probe-progress")!;
const probeProgressBar =
  document.querySelector<HTMLProgressElement>("#probe-progress-bar")!;
const probeProgressText =
  document.querySelector<HTMLElement>("#probe-progress-text")!;
const clientList = document.querySelector<HTMLElement>("#client-list")!;
const repairDialog = document.querySelector<HTMLDialogElement>("#repair-dialog")!;
const repairList = document.querySelector<HTMLElement>("#repair-list")!;
const probeDialog = document.querySelector<HTMLDialogElement>("#probe-dialog")!;
const probeList = document.querySelector<HTMLElement>("#probe-list")!;
const probeResults = document.querySelector<HTMLElement>("#probe-results")!;
const workspaceButton =
  document.querySelector<HTMLButtonElement>("#workspace-button")!;
const workspacePath = document.querySelector<HTMLElement>("#workspace-path")!;
const storagePathElement =
  document.querySelector<HTMLElement>("#storage-path")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const rollbackDialog =
  document.querySelector<HTMLDialogElement>("#rollback-dialog")!;
const rollbackList = document.querySelector<HTMLElement>("#rollback-list")!;

function t(key: string, params?: Record<string, string | number>): string {
  const template = desktopMessages[locale][key];
  if (!template) return translate(locale, key, params);
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    params?.[name] === undefined ? `{${name}}` : String(params[name])
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearProbeResults(): void {
  lastProbeReport = undefined;
  lastProbeProgress = undefined;
  probeResults.hidden = true;
  probeResults.replaceChildren();
}

function invalidateScanReport(): void {
  report = undefined;
  lastScanAt = undefined;
  clearProbeResults();
  for (const selector of [
    "#summary-clients",
    "#summary-servers",
    "#summary-problems",
    "#summary-repairs"
  ]) {
    document.querySelector(selector)!.textContent = "—";
  }
  clientList.replaceChildren();
  updateActionAvailability();
  updateScanStatus();
}

function updateActionAvailability(): void {
  const conflictingOperation = isScanning || isProbing || isPlanningProbe;
  scanButton.disabled = conflictingOperation;
  workspaceButton.disabled = conflictingOperation;
  repairButton.disabled =
    conflictingOperation || !report || report.summary.safeRepairs === 0;
  rollbackButton.disabled = conflictingOperation;
  exportButton.disabled = !report;
  probeButton.disabled = isProbing
    ? isProbeCanceling
    : isScanning || !report || report.summary.configuredServers === 0;
}

function applyTranslations(): void {
  document.documentElement.lang = locale;
  languageSelect.value = locale;
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-i18n-aria-label]"
  )) {
    element.setAttribute(
      "aria-label",
      t(element.dataset.i18nAriaLabel!)
    );
  }
  updateScanStatus();
  workspacePath.textContent = selectedProjectPath ?? t("workspace.none");
  storagePathElement.textContent = storagePath
    ? t(
        storageFallback
          ? "desktop.storageFallback"
          : "desktop.storagePortable",
        { path: storagePath }
      )
    : "";
  if (report) renderReport(report);
  if (lastProbeReport) renderProbeReport(lastProbeReport);
  scanButton.textContent = t(isScanning ? "action.scanning" : "action.scan");
  if (isProbing) {
    probeButton.textContent = t(
      isProbeCanceling ? "desktop.probeCanceling" : "desktop.probeCancel"
    );
    if (lastProbeProgress) updateProbeProgress(lastProbeProgress);
    if (isProbeCanceling) {
      probeProgressText.textContent = t("desktop.probeCanceling");
    }
  } else {
    probeButton.textContent = t("action.deepCheck");
  }
  updateActionAvailability();
}

function updateScanStatus(): void {
  scanFeedback.classList.toggle("scanning", isScanning);
  scanFeedback.classList.toggle("completed", !isScanning && Boolean(lastScanAt));
  if (isScanning) {
    scanStatus.textContent = t("scan.progress");
    return;
  }
  scanStatus.textContent = lastScanAt
    ? t("scan.lastCompleted", {
        time: new Intl.DateTimeFormat(locale, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }).format(lastScanAt)
      })
    : t("scan.ready");
}

function clientState(client: ClientScanResult): {
  className: string;
  label: string;
} {
  if (!client.configFound) {
    return { className: "muted", label: t("status.notConfigured") };
  }
  if (client.findings.some((finding) => finding.severity === "error")) {
    return { className: "error", label: t("status.error") };
  }
  if (client.findings.some((finding) => finding.severity === "warning")) {
    return { className: "warning", label: t("status.warning") };
  }
  return { className: "healthy", label: t("status.healthy") };
}

function renderReport(nextReport: ScanReport): void {
  report = nextReport;
  document.querySelector("#summary-clients")!.textContent = String(
    nextReport.summary.detectedClients
  );
  document.querySelector("#summary-servers")!.textContent = String(
    nextReport.summary.configuredServers
  );
  document.querySelector("#summary-problems")!.textContent = String(
    nextReport.summary.errors + nextReport.summary.warnings
  );
  document.querySelector("#summary-repairs")!.textContent = String(
    nextReport.summary.safeRepairs
  );

  updateActionAvailability();

  clientList.innerHTML = nextReport.clients
    .map((client) => {
      const state = clientState(client);
      const visibleFindings = client.findings.filter(
        (finding) =>
          finding.severity !== "info" || client.findings.length === 1
      );
      return `
        <article class="client-card">
          <div class="client-title">
            <span class="client-icon">${escapeHtml(client.displayName.slice(0, 1))}</span>
            <div>
              <strong>${escapeHtml(client.displayName)}</strong>
              <small>${escapeHtml(
                t("status.configuredServers", { count: client.serverCount })
              )}</small>
            </div>
          </div>
          <div>
            <span class="status-pill ${state.className}">${escapeHtml(state.label)}</span>
            <div class="client-path" title="${escapeHtml(client.configPath)}">
              ${escapeHtml(client.configPath)}
            </div>
          </div>
          <div class="client-findings">
            ${
              visibleFindings.length === 0
                ? `<div class="finding">
                    <div class="finding-title">${escapeHtml(t("scan.ok.title"))}</div>
                    <div class="finding-detail">${escapeHtml(t("scan.ok.detail"))}</div>
                  </div>`
                : visibleFindings
                    .map(
                      (finding) => `
                      <div class="finding ${finding.severity}">
                        <div class="finding-title">${escapeHtml(
                          t(finding.titleKey, finding.detailParams)
                        )}</div>
                        <div class="finding-detail">${escapeHtml(
                          t(finding.detailKey, finding.detailParams)
                        )}</div>
                      </div>`
                    )
                    .join("")
            }
          </div>
        </article>`;
    })
    .join("");
}

function acceptScanReport(nextReport: ScanReport): void {
  clearProbeResults();
  renderReport(nextReport);
}

function describeProbeTarget(target: ProbeTarget): string {
  if (target.server.url) return target.server.url;
  return [target.server.command, ...target.server.args]
    .filter(Boolean)
    .join(" ");
}

function probeStatusLabel(status: string): string {
  const keys: Record<string, string> = {
    connected: "probe.connected",
    "auth-required": "probe.authRequired",
    timeout: "probe.timeout",
    "not-found": "probe.notFound",
    failed: "probe.failed",
    unsupported: "probe.unsupported"
  };
  return t(keys[status] ?? "probe.failed");
}

function renderProbeReport(nextReport: ProbeReport): void {
  lastProbeReport = nextReport;
  probeResults.hidden = false;
  probeResults.innerHTML = `
    <h2>${escapeHtml(
      t("probe.complete", {
        connected: nextReport.summary.connected,
        total: nextReport.summary.total
      })
    )}</h2>
    <div class="probe-result-grid">
      ${nextReport.results
        .map((result) => {
          const detail =
            result.status === "connected"
              ? result.toolCount === undefined
                ? t("probe.noTools")
                : t("probe.tools", { count: result.toolCount })
              : result.detail ?? "";
          const identity = [result.serverNameReported, result.serverVersion]
            .filter(Boolean)
            .join(" ");
          return `
            <article class="probe-result ${escapeHtml(result.status)}">
              <strong>${escapeHtml(
                `${result.clientName} / ${result.serverName}`
              )}</strong>
              <span>${escapeHtml(probeStatusLabel(result.status))} · ${
                result.durationMs
              } ms</span>
              <small>${escapeHtml(
                [identity, detail].filter(Boolean).join(" · ")
              )}</small>
            </article>`;
        })
        .join("")}
    </div>`;
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error ?? "Unknown error");
}

function rollbackErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("ROLLBACK_CONFIG_CHANGED")) {
    return t("desktop.rollbackChanged");
  }
  if (
    message.includes("ROLLBACK_BACKUP_CHANGED") ||
    message.includes("ROLLBACK_INVALID_BACKUP_PATH")
  ) {
    return t("desktop.rollbackBackupChanged");
  }
  if (
    message.includes("ROLLBACK_NOT_AVAILABLE") ||
    message.includes("ROLLBACK_INVALID_SELECTION")
  ) {
    return t("desktop.rollbackUnavailable");
  }
  return t("desktop.rollbackFailed", { reason: message });
}

function updateProbeProgress(progress: {
  completed: number;
  total: number;
  current?: string;
}): void {
  lastProbeProgress = progress;
  probeProgressBar.max = Math.max(1, progress.total);
  probeProgressBar.value = Math.min(progress.completed, probeProgressBar.max);
  if (isProbeCanceling) {
    probeProgressText.textContent = t("desktop.probeCanceling");
    return;
  }
  const completed = t("desktop.probeProgress", {
    completed: progress.completed,
    total: progress.total
  });
  probeProgressText.textContent = progress.current
    ? `${completed} · ${t("desktop.probeCurrent", {
        current: progress.current
      })}`
    : completed;
}

async function openRollbackHistory(): Promise<void> {
  rollbackButton.disabled = true;
  try {
    const entries = await window.mcpmender.listRollbacks();
    rollbackList.innerHTML =
      entries.length === 0
        ? `<p>${escapeHtml(t("desktop.rollbackEmpty"))}</p>`
        : entries
            .map(
              (entry) => `
                <article class="repair-item rollback-item">
                  <strong>${escapeHtml(entry.clientName)}</strong>
                  <div class="client-path" title="${escapeHtml(entry.configPath)}">
                    ${escapeHtml(entry.configPath)}
                  </div>
                  <small>${escapeHtml(
                    new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short"
                    }).format(new Date(entry.createdAt))
                  )}</small>
                  <button
                    class="button secondary rollback-entry-button"
                    data-entry-id="${escapeHtml(entry.id)}"
                    ${entry.rolledBackAt ? "disabled" : ""}
                  >${escapeHtml(
                    entry.rolledBackAt
                      ? t("desktop.rolledBack")
                      : t("desktop.rollbackAction")
                  )}</button>
                </article>`
            )
            .join("");
    for (const button of rollbackList.querySelectorAll<HTMLButtonElement>(
      ".rollback-entry-button"
    )) {
      button.addEventListener("click", async () => {
        const entryId = button.dataset.entryId;
        if (!entryId || !window.confirm(t("desktop.rollbackConfirm"))) return;
        button.disabled = true;
        try {
          const outcome = await window.mcpmender.rollback(entryId);
          if (outcome.report) {
            acceptScanReport(outcome.report);
            lastScanAt = new Date();
          } else {
            invalidateScanReport();
          }
          updateScanStatus();
          rollbackDialog.close();
          const warnings = [
            outcome.historyWarning
              ? t("desktop.rollbackHistoryWarning")
              : undefined,
            outcome.scanWarning ? t("desktop.rollbackScanWarning") : undefined
          ].filter(Boolean);
          showToast(
            warnings.length > 0
              ? warnings.join(" ")
              : t("desktop.rollbackComplete")
          );
        } catch (error) {
          showToast(rollbackErrorMessage(error));
          button.disabled = false;
        }
      });
    }
    rollbackDialog.showModal();
  } catch (error) {
    showToast(rollbackErrorMessage(error));
  } finally {
    updateActionAvailability();
  }
}

async function runScan(announce = true): Promise<boolean> {
  if (isScanning || isProbing) return false;
  isScanning = true;
  scanButton.textContent = t("action.scanning");
  updateActionAvailability();
  updateScanStatus();
  try {
    const [nextReport] = await Promise.all([
      window.mcpmender.scan(),
      new Promise<void>((resolve) =>
        window.setTimeout(resolve, announce ? 650 : 0)
      )
    ]);
    acceptScanReport(nextReport);
    lastScanAt = new Date();
    if (announce) {
      showToast(
        t("scan.complete", {
          clients: nextReport.summary.detectedClients,
          problems:
            nextReport.summary.errors + nextReport.summary.warnings
        })
      );
    }
    return true;
  } catch (error) {
    showToast(t("desktop.scanFailed", { reason: errorMessage(error) }));
    return false;
  } finally {
    isScanning = false;
    scanButton.textContent = t("action.scan");
    updateActionAvailability();
    updateScanStatus();
  }
}

function openRepairPreview(): void {
  if (!report || report.repairs.length === 0) return;
  repairList.innerHTML = report.repairs
    .map(
      (repair) => `
        <article class="repair-item">
          <strong>${escapeHtml(repair.clientName)} / ${escapeHtml(repair.serverName)}</strong>
          <div class="client-path" title="${escapeHtml(repair.configPath)}">
            ${escapeHtml(repair.configPath)}
          </div>
          <div>${escapeHtml(t(repair.titleKey))}</div>
          <div class="command-diff">
            <span>${escapeHtml(t("repair.before"))}</span>
            <code>${escapeHtml(
              `${repair.before.command} ${repair.before.args.join(" ")}`
            )}</code>
            <span>${escapeHtml(t("repair.after"))}</span>
            <code>${escapeHtml(
              `${repair.after.command} ${repair.after.args.join(" ")}`
            )}</code>
          </div>
        </article>`
    )
    .join("");
  repairDialog.showModal();
}

async function openProbePreview(): Promise<void> {
  if (isScanning || isProbing || isPlanningProbe) return;
  isPlanningProbe = true;
  updateActionAvailability();
  try {
    const targets = await window.mcpmender.planProbe();
    if (targets.length === 0) {
      showToast(t("probe.none"));
      return;
    }
    probeList.innerHTML = targets
      .map(
        (target) => `
          <article class="repair-item">
            <strong>${escapeHtml(
              `${target.clientName} / ${target.server.name}`
            )}</strong>
            <div class="client-path" title="${escapeHtml(target.configPath)}">
              ${escapeHtml(target.configPath)}
            </div>
            <code>${escapeHtml(describeProbeTarget(target))}</code>
          </article>`
      )
      .join("");
    probeDialog.showModal();
  } catch (error) {
    showToast(t("desktop.scanFailed", { reason: errorMessage(error) }));
  } finally {
    isPlanningProbe = false;
    updateActionAvailability();
  }
}

async function runDeepProbe(): Promise<void> {
  if (isProbing) return;
  isProbing = true;
  isProbeCanceling = false;
  clearProbeResults();
  probeDialog.close();
  probeButton.textContent = t("desktop.probeCancel");
  updateActionAvailability();
  probeProgress.hidden = false;
  probeProgressBar.value = 0;
  probeProgressBar.max = 1;
  probeProgressText.textContent = t("desktop.probeProgress", {
    completed: 0,
    total: 0
  });
  try {
    const nextReport = await window.mcpmender.runProbe();
    renderProbeReport(nextReport);
    showToast(
      t("probe.complete", {
        connected: nextReport.summary.connected,
        total: nextReport.summary.total
      })
    );
  } catch (error) {
    showToast(
      errorMessage(error).includes("PROBE_CANCELLED")
        ? t("desktop.probeCanceled")
        : t("desktop.probeFailed", { reason: errorMessage(error) })
    );
  } finally {
    isProbing = false;
    isProbeCanceling = false;
    probeProgress.hidden = true;
    probeButton.textContent = t("action.deepCheck");
    updateActionAvailability();
  }
}

languageSelect.addEventListener("change", () => {
  locale = normalizeLocale(languageSelect.value);
  localStorage.setItem("mcpmender.locale", locale);
  applyTranslations();
});

scanButton.addEventListener("click", () => void runScan(true));
probeButton.addEventListener("click", () => {
  if (isProbing) {
    isProbeCanceling = true;
    probeButton.textContent = t("desktop.probeCanceling");
    probeProgressText.textContent = t("desktop.probeCanceling");
    updateActionAvailability();
    void window.mcpmender.cancelProbe();
    return;
  }
  void openProbePreview();
});
repairButton.addEventListener("click", openRepairPreview);
exportButton.addEventListener("click", async () => {
  if (!report) return;
  exportButton.disabled = true;
  try {
    const result = await window.mcpmender.exportReport(locale);
    if (result.saved) showToast(t("report.saved"));
  } catch (error) {
    showToast(t("desktop.exportFailed", { reason: errorMessage(error) }));
  } finally {
    exportButton.disabled = false;
  }
});
helpButton.addEventListener("click", async () => {
  try {
    await window.mcpmender.openHelp(locale);
  } catch (error) {
    showToast(t("desktop.scanFailed", { reason: errorMessage(error) }));
  }
});
rollbackButton.addEventListener("click", () => void openRollbackHistory());
workspaceButton.addEventListener("click", async () => {
  workspaceButton.disabled = true;
  try {
    const result = await window.mcpmender.selectProject(locale);
    if (result.path) {
      selectedProjectPath = result.path;
      workspacePath.textContent = result.path;
    }
    if (result.report) {
      acceptScanReport(result.report);
      lastScanAt = new Date();
      updateScanStatus();
    }
  } catch (error) {
    showToast(t("desktop.projectFailed", { reason: errorMessage(error) }));
  } finally {
    updateActionAvailability();
  }
});
document
  .querySelector("#probe-dialog-close")!
  .addEventListener("click", () => probeDialog.close());
document
  .querySelector("#probe-cancel")!
  .addEventListener("click", () => probeDialog.close());
document
  .querySelector("#probe-confirm")!
  .addEventListener("click", () => void runDeepProbe());

document.querySelector("#dialog-close")!.addEventListener("click", () => repairDialog.close());
document.querySelector("#dialog-cancel")!.addEventListener("click", () => repairDialog.close());
document.querySelector("#dialog-confirm")!.addEventListener("click", async () => {
  if (!report) return;
  const button = document.querySelector<HTMLButtonElement>("#dialog-confirm")!;
  button.disabled = true;
  try {
    const result = await window.mcpmender.repairSafe(
      report.repairs.map((repair) => repair.id)
    );
    repairDialog.close();
    const applied = result.results.filter((item) => item.applied).length;
    const repairMessage =
      applied === result.results.length && applied > 0
        ? t("repair.complete")
        : applied > 0
          ? t("desktop.repairPartial", {
              applied,
              total: result.results.length
            })
          : t(result.results[0]?.messageKey ?? "repair.failed");
    const scanSucceeded = await runScan(false);
    if (!scanSucceeded) invalidateScanReport();
    const repairWarnings = [
      result.manifestWarning
        ? t("desktop.repairManifestWarning")
        : undefined,
      result.historyWarning ? t("desktop.repairHistoryWarning") : undefined,
      !scanSucceeded ? t("desktop.repairScanWarning") : undefined
    ].filter(Boolean);
    showToast([repairMessage, ...repairWarnings].join(" "));
  } catch (error) {
    showToast(t("desktop.repairFailed", { reason: errorMessage(error) }));
  } finally {
    button.disabled = false;
  }
});

document
  .querySelector("#rollback-dialog-close")!
  .addEventListener("click", () => rollbackDialog.close());
document
  .querySelector("#rollback-close")!
  .addEventListener("click", () => rollbackDialog.close());

window.mcpmender.onProbeProgress(updateProbeProgress);

applyTranslations();
void window.mcpmender
  .storageInfo()
  .then((info) => {
    storagePath = info.dataDir;
    storageFallback = info.fallback;
    applyTranslations();
  })
  .catch((error) =>
    showToast(t("desktop.scanFailed", { reason: errorMessage(error) }))
  );
void runScan(false);
