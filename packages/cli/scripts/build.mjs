import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
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
await Promise.all([
  copyFile("../../LICENSE", "dist/LICENSE"),
  copyFile("../../THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md")
]);
