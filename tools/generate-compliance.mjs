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

for (const [license, packages] of Object.entries(licenseGroups)) {
  for (const item of packages) {
    for (const version of item.versions) {
      const key = `${item.name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const encodedName = item.name.startsWith("@")
        ? item.name
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/")
        : encodeURIComponent(item.name);
      components.push({
        type: "library",
        "bom-ref": `pkg:npm/${encodedName}@${version}`,
        name: item.name,
        version,
        licenses: [{ license: { id: license } }],
        purl: `pkg:npm/${encodedName}@${version}`,
        externalReferences: item.homepage
          ? [{ type: "website", url: item.homepage }]
          : undefined
      });
    }
  }
}
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
