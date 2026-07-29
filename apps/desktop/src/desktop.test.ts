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

    expect(preload).toContain("repairSafe: (repairIds: string[])");
    expect(preload).toContain(
      'ipcRenderer.invoke("mcpmender:repair-safe", repairIds)'
    );
    expect(renderer).toContain("report.repairs.map((repair) => repair.id)");
    expect(main).toContain("Array.isArray(repairIds)");
    expect(main).toContain("repairIds.length > 256");
    expect(main).toContain("lastScanReport?.repairs ?? []");
    expect(main).toContain("Repair selection is stale or unknown.");
    expect(main).not.toContain("applySafeRepairs(repairIds)");
  });

  it("exports only a cached or freshly scanned main-process report", async () => {
    const [main, preload, renderer] = await Promise.all([
      readFile(path.resolve(process.cwd(), "src/main.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/preload.ts"), "utf8"),
      readFile(path.resolve(process.cwd(), "src/renderer.ts"), "utf8")
    ]);

    expect(preload).toContain("exportReport: ():");
    expect(preload).toContain('ipcRenderer.invoke("mcpmender:export-report")');
    expect(renderer).toContain("window.mcpmender.exportReport()");
    expect(main).toContain(
      "const report = lastScanReport ?? (await performScan())"
    );
  });
});
