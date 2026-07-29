import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    mainFields: ["module", "main"],
    target: "node20",
    external: ["electron"],
    sourcemap: true
  }),
  build({
    entryPoints: ["src/preload.ts"],
    outfile: "dist/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    mainFields: ["module", "main"],
    target: "node20",
    external: ["electron"],
    sourcemap: true
  }),
  build({
    entryPoints: ["src/renderer.ts"],
    outfile: "dist/renderer.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    sourcemap: true
  }),
  copyFile("src/index.html", "dist/index.html"),
  copyFile("src/styles.css", "dist/styles.css"),
  copyFile("../../docs/MCPulse-Handbook.html", "dist/MCPulse-Handbook.html")
]);
