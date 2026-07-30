import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return path.resolve(process.argv[index + 1]);
}

const inputPath = argument("--input");
const sbomPath = argument("--sbom");
const noticesPath = argument("--notices");
const licenseGroups = JSON.parse(
  (await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "")
);
const components = [];
const seen = new Set();

function addComponent(name, version, license, homepage) {
  const key = `${name}@${version}`;
  if (seen.has(key)) return;
  seen.add(key);
  const encodedName = name.startsWith("@")
    ? name
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")
    : encodeURIComponent(name);
  components.push({
    type: "library",
    "bom-ref": `pkg:npm/${encodedName}@${version}`,
    name,
    version,
    licenses: [{ license: { id: license } }],
    purl: `pkg:npm/${encodedName}@${version}`,
    externalReferences: homepage
      ? [{ type: "website", url: homepage }]
      : undefined
  });
}

for (const [license, packages] of Object.entries(licenseGroups)) {
  for (const item of packages) {
    for (const version of item.versions) {
      addComponent(item.name, version, license, item.homepage);
    }
  }
}

// Electron is installed as a build-time dependency, but its runtime and Chromium
// are shipped in every Desktop artifact. Production-only package inventories do
// not report it, so add the exact bundled Electron version explicitly.
const desktopManifest = JSON.parse(
  await readFile(path.resolve("apps/desktop/package.json"), "utf8")
);
const electronVersion = desktopManifest.devDependencies?.electron;
if (!electronVersion || !/^\d+\.\d+\.\d+/.test(electronVersion)) {
  throw new Error("Desktop manifest does not contain an exact Electron version");
}
addComponent(
  "electron",
  electronVersion,
  "MIT",
  "https://github.com/electron/electron"
);
components.sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)
);

const workspace = JSON.parse(
  await readFile(path.resolve("package.json"), "utf8")
);
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: "MCPMender",
      version: workspace.version,
      licenses: [{ license: { id: "Apache-2.0" } }]
    },
    tools: {
      components: [
        {
          type: "application",
          name: "MCPMender compliance generator",
          version: workspace.version
        }
      ]
    }
  },
  components
};

const lines = [
  "# MCPMender production dependency notices",
  "",
  `Generated from the installed production dependency graph for MCPMender ${workspace.version}.`,
  "The authoritative license text remains the LICENSE file shipped by each dependency.",
  ""
];
for (const component of components) {
  const license = component.licenses[0].license.id;
  const website = component.externalReferences?.[0]?.url;
  lines.push(
    `- ${component.name} ${component.version} — ${license}${website ? ` — ${website}` : ""}`
  );
}
lines.push("");

await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
await writeFile(noticesPath, `${lines.join("\n")}\n`, "utf8");
