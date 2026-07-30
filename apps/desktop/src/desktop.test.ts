import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop diagnostics workflow", () => {
  it("includes explicit deep-check preview and result surfaces", async () => {
    const html = await readFile(
      path.resolve(process.cwd(), "src/index.html"),
      "utf8"
    );
    expect(html).toContain('id="probe-button"');
    expect(html).toContain('id="probe-dialog"');
    expect(html).toContain('data-i18n="probe.safety"');
    expect(html).toContain('id="probe-results"');
    expect(html).toContain('id="workspace-button"');
    expect(html).toContain('id="workspace-path"');
  });

  it("ships a restrictive content security policy without unsafe fallbacks", async () => {
    const html = await readFile(
      path.resolve(process.cwd(), "src/index.html"),
      "utf8"
    );
    const policy = html.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/
    )?.[1];
    expect(policy).toBeDefined();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/https?:/);
  });

  it("hardens BrowserWindow and rejects navigation outside packaged files", async () => {
    const main = await readFile(
      path.resolve(process.cwd(), "src/main.ts"),
      "utf8"
    );
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("webSecurity: true");
    expect(main).toContain("setWindowOpenHandler(() => ({ action: \"deny\" }))");
    expect(main).toContain("if (!url.startsWith(allowedRoot)) event.preventDefault()");
    expect(main).toContain(
      "if (!mainWindow || event.sender !== mainWindow.webContents)"
    );
  });

  it("passes only repair IDs and keeps trusted repair data in the main process", async () => {
    const [main, preload, renderer] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/preload.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8")
    ]);

    expect(preload).toContain("repairSafe: (");
    expect(preload).toContain("repairIds: string[]");
    expect(preload).toContain(
      'ipcRenderer.invoke("mcpmender:repair-safe", repairIds)'
    );
    expect(renderer).toContain("report.repairs.map((repair) => repair.id)");
    expect(main).toContain("Array.isArray(repairIds)");
    expect(main).toContain("repairIds.length > 256");
    expect(main).toContain("trustedReport.repairs.filter");
    expect(main).toContain("Repair selection is stale or unknown.");
    expect(main).not.toContain("applySafeRepairs(repairIds)");
  });

  it("exports only a cached or freshly scanned main-process report", async () => {
    const [main, preload, renderer] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/preload.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8")
    ]);

    expect(preload).toContain("exportReport: (");
    expect(preload).toContain(
      'ipcRenderer.invoke("mcpmender:export-report", locale)'
    );
    expect(renderer).toContain("window.mcpmender.exportReport(locale)");
    expect(main).toContain(
      "const report = lastScanReport ?? (await performScan())"
    );
  });

  it("provides bounded deep-check progress and safe cancellation", async () => {
    const [main, preload, renderer, html] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/preload.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/index.html"), "utf8")
    ]);

    expect(main).toContain("const controller = new AbortController()");
    expect(main).toContain('event.sender.send("mcpmender:probe-progress"');
    expect(main).toContain('ipcMain.handle("mcpmender:probe-cancel"');
    expect(main).toContain("while (!controller.signal.aborted");
    expect(preload).toContain('ipcRenderer.invoke("mcpmender:probe-cancel")');
    expect(preload).toContain(
      'ipcRenderer.on("mcpmender:probe-progress", listener)'
    );
    expect(renderer).toContain("window.mcpmender.cancelProbe()");
    expect(renderer).toContain("updateProbeProgress");
    expect(html).toContain('id="probe-progress-bar"');
  });

  it("keeps rollback authority and integrity validation in the main process", async () => {
    const [main, preload, renderer, html] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/preload.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/index.html"), "utf8")
    ]);

    expect(main).toContain("isPathInside(backupRoot, entry.backupPath)");
    expect(main).toContain("sha256(backupBytes) !== entry.backupHash");
    expect(main).toContain("sha256(currentBytes) !== entry.repairedHash");
    expect(main).toContain("rollbackRepair(entry.backupPath, entry.configPath, {");
    expect(main).toContain("expectedCurrentHash: entry.repairedHash");
    expect(preload).toContain(
      'ipcRenderer.invoke("mcpmender:rollback-run", entryId)'
    );
    expect(renderer).toContain("window.confirm(t(\"desktop.rollbackConfirm\"))");
    expect(html).toContain('id="rollback-dialog"');
  });

  it("uses portable writable storage with an explicit fallback", async () => {
    const [main, renderer] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8")
    ]);

    expect(main).toContain("process.env.PORTABLE_EXECUTABLE_DIR");
    expect(main).toContain('["userData", "user-data"]');
    expect(main).toContain('["sessionData", "session-data"]');
    expect(main).toContain('["cache", "cache"]');
    expect(main).toContain('["crashDumps", "crash-dumps"]');
    expect(main).toContain('["logs", "logs"]');
    expect(main).toContain("app.setPath(name, target)");
    expect(renderer).toContain("desktop.storageFallback");
  });

  it("keeps packaged file loading functional and adapts to narrow views", async () => {
    const [packageJson, styles] = await Promise.all([
      readFile(path.resolve(process.cwd(), "package.json"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/styles.css"), "utf8")
    ]);
    const manifest = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      build: {
        electronFuses: { grantFileProtocolExtraPrivileges: boolean };
      };
    };

    // Electron's loadFile() reads renderer assets from app.asar through file://.
    // Disabling this fuse makes the packaged window fail with ERR_FILE_NOT_FOUND.
    expect(mainWindowUsesLoadFile(await readFile(
      path.resolve(process.cwd(), "src/main.ts"),
      "utf8"
    ))).toBe(true);
    expect(
      manifest.build.electronFuses.grantFileProtocolExtraPrivileges
    ).toBe(true);
    expect(manifest.dependencies?.["@mcpmender/core"]).toBeUndefined();
    expect(manifest.devDependencies?.["@mcpmender/core"]).toBe("workspace:*");
    expect(styles).toContain("@media (max-width: 720px)");
    expect(styles).toContain("min-width: 0");
  });

  it("fails release captures when the expected renderer DOM is absent", async () => {
    const main = await readFile(
      path.resolve(process.cwd(), "src/main.ts"),
      "utf8"
    );

    expect(main).toContain("captureTarget === \"help\"");
    expect(main).toContain(
      "\"document.querySelector('#help-button')?.click()\""
    );
    expect(main).toContain("captureWindow = await waitForHelpWindow()");
    expect(main).toContain('expectedSelector');
    expect(main).toContain('webContents.executeJavaScript(');
    expect(main).toContain("if (!rendererReady)");
    expect(main).toContain("app.exit(70)");
  });

  it("keeps raw repair authority in main while redacting renderer reports", async () => {
    const main = await readFile(
      path.resolve(process.cwd(), "src/main.ts"),
      "utf8"
    );

    expect(main).toContain("lastScanReport = await scanMcpConfigurations");
    expect(main).toContain("return rendererReport(lastScanReport)");
    expect(main).toContain("const safeReport = redactReport(report)");
    expect(main).toContain("id: opaqueRepairId(report, report.repairs[index])");
    expect(main).toContain("rendererRepairBatch(result, trustedReport)");
    expect(main).toContain("trustedReport.repairs.filter");
  });

  it("writes desktop history atomically and reports post-mutation warnings", async () => {
    const [main, renderer] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8")
    ]);

    expect(main).toContain("async function writeJsonAtomically");
    expect(main).toContain("await rename(temporaryPath, targetPath)");
    expect(main).toContain('historyWarning: "REPAIR_HISTORY_SAVE_FAILED"');
    expect(renderer).toContain("desktop.repairManifestWarning");
    expect(main).toContain('historyWarning: "ROLLBACK_HISTORY_SAVE_FAILED"');
    expect(main).toContain('scanWarning: "ROLLBACK_RESCAN_FAILED"');
    expect(renderer).toContain("desktop.repairHistoryWarning");
    expect(renderer).toContain("desktop.rollbackHistoryWarning");
  });

  it("invalidates stale probe results and coordinates conflicting actions", async () => {
    const renderer = await readFile(
      path.resolve(process.cwd(), "src/renderer.ts"),
      "utf8"
    );

    expect(renderer).toContain("function clearProbeResults()");
    expect(renderer).toContain("function acceptScanReport");
    expect(renderer).toContain("clearProbeResults()");
    expect(renderer).toContain(
      "const conflictingOperation = isScanning || isProbing || isPlanningProbe"
    );
    expect(renderer).toContain("isPlanningProbe");
    expect(renderer).toContain("await runScan(false)");
    expect(renderer).toContain("repair.configPath");
    expect(renderer).toContain("target.configPath");
  });

  it("uses a single instance and waits for active probe cleanup on quit", async () => {
    const main = await readFile(
      path.resolve(process.cwd(), "src/main.ts"),
      "utf8"
    );

    expect(main).toContain("app.requestSingleInstanceLock()");
    expect(main).toContain('app.on("second-instance"');
    expect(main).toContain('app.on("before-quit"');
    expect(main).toContain("activeProbe.controller.abort()");
    expect(main).toContain("signal: controller.signal");
    expect(main).toContain("if (quitAfterProbe)");
    expect(main).toContain("{ query: { lang: locale } }");
  });
});

function mainWindowUsesLoadFile(main: string): boolean {
  return main.includes(
    "mainWindow.loadFile(path.join(__dirname, initialPage), initialLoadOptions)"
  );
}
