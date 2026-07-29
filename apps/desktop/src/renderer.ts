import {
  normalizeLocale,
  translate
} from "@mcpulse/core/i18n";
import type {
  ClientScanResult,
  Locale,
  ScanReport
} from "@mcpulse/core/types";

let locale: Locale = normalizeLocale(
  localStorage.getItem("mcpulse.locale") ?? navigator.language
);
let report: ScanReport | undefined;
let toastTimer: number | undefined;
let lastScanAt: Date | undefined;
let isScanning = false;

const languageSelect = document.querySelector<HTMLSelectElement>("#language-select")!;
const scanButton = document.querySelector<HTMLButtonElement>("#scan-button")!;
const repairButton = document.querySelector<HTMLButtonElement>("#repair-button")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-button")!;
const helpButton = document.querySelector<HTMLButtonElement>("#help-button")!;
const scanFeedback = document.querySelector<HTMLElement>("#scan-feedback")!;
const scanStatus = document.querySelector<HTMLElement>("#scan-status")!;
const clientList = document.querySelector<HTMLElement>("#client-list")!;
const repairDialog = document.querySelector<HTMLDialogElement>("#repair-dialog")!;
const repairList = document.querySelector<HTMLElement>("#repair-list")!;
const toast = document.querySelector<HTMLElement>("#toast")!;

function t(key: string, params?: Record<string, string | number>): string {
  return translate(locale, key, params);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyTranslations(): void {
  document.documentElement.lang = locale;
  languageSelect.value = locale;
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  updateScanStatus();
  if (report) renderReport(report);
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

  repairButton.disabled = nextReport.summary.safeRepairs === 0;
  exportButton.disabled = false;

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

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

async function runScan(announce = true): Promise<void> {
  if (isScanning) return;
  isScanning = true;
  scanButton.disabled = true;
  scanButton.textContent = t("action.scanning");
  updateScanStatus();
  try {
    const [nextReport] = await Promise.all([
      window.mcpulse.scan(),
      new Promise<void>((resolve) =>
        window.setTimeout(resolve, announce ? 650 : 0)
      )
    ]);
    renderReport(nextReport);
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
  } catch {
    showToast(t("scan.failed"));
  } finally {
    isScanning = false;
    scanButton.disabled = false;
    scanButton.textContent = t("action.scan");
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

languageSelect.addEventListener("change", () => {
  locale = normalizeLocale(languageSelect.value);
  localStorage.setItem("mcpulse.locale", locale);
  applyTranslations();
});

scanButton.addEventListener("click", () => void runScan(true));
repairButton.addEventListener("click", openRepairPreview);
exportButton.addEventListener("click", async () => {
  if (!report) return;
  const result = await window.mcpulse.exportReport(report);
  if (result.saved) showToast(t("report.saved"));
});
helpButton.addEventListener("click", () => void window.mcpulse.openHelp());

document.querySelector("#dialog-close")!.addEventListener("click", () => repairDialog.close());
document.querySelector("#dialog-cancel")!.addEventListener("click", () => repairDialog.close());
document.querySelector("#dialog-confirm")!.addEventListener("click", async () => {
  if (!report) return;
  const button = document.querySelector<HTMLButtonElement>("#dialog-confirm")!;
  button.disabled = true;
  try {
    const result = await window.mcpulse.repairSafe(report.repairs);
    repairDialog.close();
    const applied = result.results.filter((item) => item.applied).length;
    showToast(applied > 0 ? t("repair.complete") : t("repair.failed"));
    await runScan();
  } finally {
    button.disabled = false;
  }
});

applyTranslations();
void runScan(false);
