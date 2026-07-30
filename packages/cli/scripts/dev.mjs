import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { build } from "esbuild";

const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mcpmender-dev.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  mainFields: ["module", "main"],
  target: "node20",
  define: {
    __MCPMENDER_VERSION__: JSON.stringify(packageMetadata.version)
  }
});

const child = spawn(
  process.execPath,
  ["dist/mcpmender-dev.cjs", ...process.argv.slice(2)],
  { stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 1));
