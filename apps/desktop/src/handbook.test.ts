import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const handbookPath = path.resolve(
  process.cwd(),
  "../../docs/MCPulse-Handbook.html"
);

describe("offline handbook", () => {
  it("contains the three selectable languages and every help section", async () => {
    const html = await readFile(handbookPath, "utf8");

    expect(html).toContain('<option value="en">English</option>');
    expect(html).toContain('<option value="zh-CN">简体中文</option>');
    expect(html).toContain('<option value="ja">日本語</option>');

    for (const id of [
      "understand",
      "quick-start",
      "desktop",
      "statuses",
      "repair",
      "cli",
      "privacy",
      "platforms",
      "reports",
      "faq",
      "habits",
      "glossary"
    ]) {
      expect(html.match(new RegExp(`id: "${id}"`, "g"))).toHaveLength(3);
    }
  });

  it("is a standalone offline document", async () => {
    const html = await readFile(handbookPath, "utf8");

    expect(html).not.toMatch(
      /<(?:script|link|img)[^>]+(?:src|href)=["']https?:\/\//i
    );
    expect(html).toContain("@media print");
    expect(html).toContain("localStorage");
  });
});
