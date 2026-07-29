import { copyFile, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/main.ts"],
    outfile: "dist/main.cjs",
    bundle: true,
    alias: {
      "@mcpmender/core": path.resolve("../../packages/core/src/index.ts")
    },
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
  copyFile("assets/icons/icon.png", "dist/icon.png"),
  copyFile("../../docs/MCPMender-Handbook.html", "dist/MCPMender-Handbook.html")
]);
