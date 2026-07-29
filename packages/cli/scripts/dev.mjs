import { spawn } from "node:child_process";
import process from "node:process";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mcpmender-dev.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  mainFields: ["module", "main"],
  target: "node20"
});

const child = spawn(
  process.execPath,
  ["dist/mcpmender-dev.cjs", ...process.argv.slice(2)],
  { stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 1));
