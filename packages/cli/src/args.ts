export type CliCommand = "scan" | "probe" | "repair";

export interface CliArguments {
  command: CliCommand;
  help: boolean;
  version: boolean;
  json: boolean;
  lang?: "en" | "zh-CN" | "ja";
  run: boolean;
  timeout: number;
  servers: string[];
  applySafe: boolean;
}

const VALUE_FLAGS = new Set(["--lang", "--timeout", "--server"]);
const BOOLEAN_FLAGS = new Set([
  "--json",
  "--run",
  "--apply-safe",
  "--help",
  "-h",
  "--version",
  "-v"
]);

function fail(message: string): never {
  throw new Error(`${message}\nRun "mcpmender --help" to see available commands.`);
}

export function parseCliArguments(argv: string[]): CliArguments {
  const normalizedArgv =
    argv[0] === "help" ? ["--help", ...argv.slice(1)] : argv;
  const first = normalizedArgv[0];
  const command: CliCommand =
    first && !first.startsWith("-")
      ? first === "scan" || first === "probe" || first === "repair"
        ? first
        : fail(`Unknown command: ${first}`)
      : "scan";
  const args =
    first && !first.startsWith("-") ? normalizedArgv.slice(1) : normalizedArgv;
  const values = new Map<string, string[]>();
  const booleans = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const equals = argument.indexOf("=");
    const flag = equals >= 0 ? argument.slice(0, equals) : argument;
    const inlineValue = equals >= 0 ? argument.slice(equals + 1) : undefined;

    if (VALUE_FLAGS.has(flag)) {
      const value = inlineValue ?? args[index + 1];
      if (!value || (!inlineValue && value.startsWith("-"))) {
        fail(`${flag} requires a value.`);
      }
      if (inlineValue === undefined) index += 1;
      values.set(flag, [...(values.get(flag) ?? []), value]);
      continue;
    }

    if (BOOLEAN_FLAGS.has(flag) && inlineValue === undefined) {
      booleans.add(flag);
      continue;
    }
    fail(`Unknown option: ${argument}`);
  }

  const allowed = new Set(["--lang", "--json", "--help", "-h", "--version", "-v"]);
  if (command === "probe") {
    allowed.add("--run");
    allowed.add("--timeout");
    allowed.add("--server");
  }
  if (command === "repair") allowed.add("--apply-safe");
  for (const flag of [...values.keys(), ...booleans]) {
    if (!allowed.has(flag)) fail(`Option ${flag} is not valid for ${command}.`);
  }

  const rawLang = values.get("--lang")?.at(-1);
  if (rawLang && !["en", "zh-CN", "ja"].includes(rawLang)) {
    fail("--lang must be one of: en, zh-CN, ja.");
  }
  const rawTimeout = values.get("--timeout")?.at(-1) ?? "8000";
  const timeout = Number(rawTimeout);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 60_000) {
    fail("--timeout must be an integer between 1000 and 60000 milliseconds.");
  }
  const servers = values.get("--server") ?? [];
  if (servers.some((server) => server.trim().length === 0)) {
    fail("--server requires a non-empty server name.");
  }

  return {
    command,
    help: booleans.has("--help") || booleans.has("-h"),
    version: booleans.has("--version") || booleans.has("-v"),
    json: booleans.has("--json"),
    lang: rawLang as CliArguments["lang"],
    run: booleans.has("--run"),
    timeout,
    servers,
    applySafe: booleans.has("--apply-safe")
  };
}
