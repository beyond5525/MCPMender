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
});
