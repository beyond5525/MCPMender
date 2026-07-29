import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

function executableExtensions(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): string[] {
  if (platform !== "win32") return [""];
  return (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.toLowerCase());
}

async function isExecutable(
  candidate: string,
  platform: NodeJS.Platform
): Promise<boolean> {
  try {
    await access(
      candidate,
      platform === "win32" ? constants.F_OK : constants.F_OK | constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutable(
  command: string,
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
  } = {}
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const extensions = executableExtensions(platform, environment);
  const expandedCommand = expandEnvironmentVariables(command, environment);
  const hasExtension =
    platform !== "win32" ||
    extensions.some((extension) =>
      expandedCommand.toLowerCase().endsWith(extension)
    );
  const candidatesFor = (base: string): string[] =>
    hasExtension ? [base] : [base, ...extensions.map((ext) => `${base}${ext}`)];

  if (
    platformPath.isAbsolute(expandedCommand) ||
    expandedCommand.includes("/") ||
    expandedCommand.includes("\\")
  ) {
    for (const candidate of candidatesFor(expandedCommand)) {
      if (await isExecutable(candidate, platform)) return candidate;
    }
    return undefined;
  }

  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of (environment.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const candidate of candidatesFor(
      platformPath.join(directory, expandedCommand)
    )) {
      if (await isExecutable(candidate, platform)) return candidate;
    }
  }
  return undefined;
}

export function expandEnvironmentVariables(
  value: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  return value
    .replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (match, name: string) => environment[name] ?? match
    )
    .replace(
      /%([A-Za-z_][A-Za-z0-9_]*)%/g,
      (match, name: string) => environment[name] ?? match
    );
}

export function referencedEnvironmentVariables(value: string): string[] {
  const matches = [
    ...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g),
    ...value.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/g)
  ];
  return [...new Set(matches.map((match) => match[1]))];
}

export function missingEnvironmentVariables(
  server: {
    command?: string;
    args: string[];
    url?: string;
    cwd?: string;
    env?: Record<string, string>;
  },
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const values = [
    server.command,
    ...server.args,
    server.url,
    server.cwd,
    ...Object.values(server.env ?? {})
  ].filter((value): value is string => typeof value === "string");
  const referenced = new Set(
    values.flatMap((value) => referencedEnvironmentVariables(value))
  );
  for (const configured of Object.keys(server.env ?? {})) {
    referenced.delete(configured);
  }
  return [...referenced].filter((name) => !environment[name]).sort();
}
