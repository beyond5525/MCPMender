import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mcpmender.cjs",
  bundle: true,
  alias: {
    "@mcpmender/core": path.resolve("../core/src/index.ts")
  },
  platform: "node",
  format: "cjs",
  mainFields: ["module", "main"],
  target: "node20",
  define: {
    __MCPMENDER_VERSION__: JSON.stringify(packageMetadata.version)
  },
  sourcemap: true
});

const output = await readFile("dist/mcpmender.cjs", "utf8");
await writeFile("dist/mcpmender.cjs", `#!/usr/bin/env node\n${output}`, "utf8");
await chmod("dist/mcpmender.cjs", 0o755);
await Promise.all([
  copyFile("../../LICENSE", "dist/LICENSE"),
  copyFile("../../THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md")
]);
