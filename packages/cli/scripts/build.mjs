import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mcpulse.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  mainFields: ["module", "main"],
  target: "node20",
  sourcemap: true
});

const output = await readFile("dist/mcpulse.cjs", "utf8");
await writeFile("dist/mcpulse.cjs", `#!/usr/bin/env node\n${output}`, "utf8");
await chmod("dist/mcpulse.cjs", 0o755);
