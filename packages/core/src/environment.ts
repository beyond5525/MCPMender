import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { ServerDefinition } from "./types.js";

type VariableSyntax = NonNullable<ServerDefinition["variableSyntax"]>;

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const exact = environment[name];
  if (exact !== undefined || platform !== "win32") return exact;
  const matchingKey = Object.keys(environment).find(
    (key) => key.toLowerCase() === name.toLowerCase()
  );
  return matchingKey ? environment[matchingKey] : undefined;
}

function executableExtensions(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
): string[] {
  if (platform !== "win32") return [""];
  return (
    environmentValue(environment, "PATHEXT", platform) ??
    ".COM;.EXE;.BAT;.CMD"
  )
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

export function expandEnvironmentVariables(
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return value
    .replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (match, name: string) =>
        environmentValue(environment, name, platform) ?? match
    )
    .replace(
      /%([A-Za-z_][A-Za-z0-9_]*)%/g,
      (match, name: string) =>
        environmentValue(environment, name, platform) ?? match
    );
}

export function expandServerVariables(
  value: string,
  syntax: VariableSyntax = "generic",
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  workspaceDir?: string
): string {
  let result = value;
  if (syntax === "gemini") {
    result = result.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g,
      (_match, name: string, fallback: string) =>
        environmentValue(environment, name, platform) || fallback
    );
  }
  if (syntax === "opencode") {
    result = result.replace(
      /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (match, name: string) =>
        environmentValue(environment, name, platform) ?? match
    );
  }
  if (syntax === "vscode") {
    result = result
      .replace(
        /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g,
        (match, name: string) =>
          environmentValue(environment, name, platform) ?? match
      )
      .replace(
        /\$\{workspaceFolder\}/g,
        workspaceDir ?? "${workspaceFolder}"
      );
  }
  result = expandEnvironmentVariables(result, environment, platform);
  if (syntax === "gemini") {
    result = result.replace(
      /\$(?!\{)([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, name: string) =>
        environmentValue(environment, name, platform) ?? match
    );
  }
  return result;
}

export function resolveServerEnvironment(
  server: ServerDefinition,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...environment };
  for (const key of server.inheritEnvKeys ?? []) {
    const value = environmentValue(environment, key, platform);
    if (value !== undefined) resolved[key] = value;
  }
  for (const [key, value] of Object.entries(server.env ?? {})) {
    resolved[key] = expandServerVariables(
      value,
      server.variableSyntax,
      environment,
      platform,
      server.workspaceDir
    );
  }
  return resolved;
}

export async function resolveExecutable(
  command: string,
  options: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    cwd?: string;
    variableSyntax?: VariableSyntax;
    workspaceDir?: string;
  } = {}
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const extensions = executableExtensions(platform, environment);
  const expandedCommand = expandServerVariables(
    command,
    options.variableSyntax,
    environment,
    platform,
    options.workspaceDir
  );
  const expandedCwd = options.cwd
    ? expandServerVariables(
        options.cwd,
        options.variableSyntax,
        environment,
        platform,
        options.workspaceDir
      )
    : undefined;
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
    const commandPath = platformPath.isAbsolute(expandedCommand)
      ? expandedCommand
      : platformPath.resolve(expandedCwd ?? process.cwd(), expandedCommand);
    for (const candidate of candidatesFor(commandPath)) {
      if (await isExecutable(candidate, platform)) return candidate;
    }
    return undefined;
  }

  const delimiter = platform === "win32" ? ";" : ":";
  const searchPath = environmentValue(environment, "PATH", platform) ?? "";
  for (const directory of searchPath.split(delimiter)) {
    if (!directory) continue;
    for (const candidate of candidatesFor(
      platformPath.join(directory, expandedCommand)
    )) {
      if (await isExecutable(candidate, platform)) return candidate;
    }
  }
  return undefined;
}

interface EnvironmentReference {
  name: string;
  hasFallback: boolean;
}

function environmentReferences(
  value: string,
  syntax: VariableSyntax = "generic"
): EnvironmentReference[] {
  const references: EnvironmentReference[] = [];
  if (syntax === "gemini") {
    for (const match of value.matchAll(
      /\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g
    )) {
      references.push({ name: match[1], hasFallback: true });
    }
    const withoutFallbacks = value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g,
      ""
    );
    for (const match of withoutFallbacks.matchAll(
      /\$(?!\{)([A-Za-z_][A-Za-z0-9_]*)/g
    )) {
      references.push({ name: match[1], hasFallback: false });
    }
  }
  if (syntax === "opencode") {
    for (const match of value.matchAll(
      /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g
    )) {
      references.push({ name: match[1], hasFallback: false });
    }
  }
  if (syntax === "vscode") {
    for (const match of value.matchAll(
      /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g
    )) {
      references.push({ name: match[1], hasFallback: false });
    }
  }
  for (const match of value.matchAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  )) {
    if (syntax === "vscode" && match[1] === "workspaceFolder") continue;
    references.push({ name: match[1], hasFallback: false });
  }
  for (const match of value.matchAll(
    /%([A-Za-z_][A-Za-z0-9_]*)%/g
  )) {
    references.push({ name: match[1], hasFallback: false });
  }
  return references;
}

export function referencedEnvironmentVariables(value: string): string[] {
  return [
    ...new Set(environmentReferences(value).map((reference) => reference.name))
  ];
}

export function missingEnvironmentVariables(
  server: ServerDefinition,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const values = [
    server.command,
    ...server.args,
    server.url,
    server.cwd,
    ...Object.values(server.env ?? {}),
    ...Object.values(server.headers ?? {})
  ].filter((value): value is string => typeof value === "string");
  const references = values.flatMap((value) =>
    environmentReferences(value, server.variableSyntax)
  );
  const required = new Set(
    references
      .filter((reference) => !reference.hasFallback)
      .map((reference) => reference.name)
  );

  for (const [key, value] of Object.entries(server.env ?? {})) {
    const selfReferenced = environmentReferences(
      value,
      server.variableSyntax
    ).some((reference) => reference.name.toLowerCase() === key.toLowerCase());
    if (value && !selfReferenced) required.delete(key);
  }
  for (const name of server.inheritEnvKeys ?? []) required.add(name);
  if (server.bearerTokenEnvVar) required.add(server.bearerTokenEnvVar);
  for (const name of Object.values(server.headerEnv ?? {})) required.add(name);

  return [...required]
    .filter(
      (name) => !environmentValue(environment, name, platform)
    )
    .sort();
}
