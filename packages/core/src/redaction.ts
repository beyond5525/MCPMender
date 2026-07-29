const AUTHORIZATION_PATTERN =
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g
];

const SENSITIVE_NAME_PATTERN =
  /^(?:apiKey|accessToken|authToken|clientSecret|privateKey|sessionKey|authorization|credential|password|passwd|secret|token)$/i;

const SENSITIVE_TEXT_KEY_PATTERN =
  /(["']?(?:api[-_]?key|apiKey|access[-_]?token|accessToken|auth[-_]?token|authToken|client[-_]?secret|clientSecret|private[-_]?key|privateKey|session[-_]?key|sessionKey|authorization|credential|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&#]+)/gi;

const CLI_SECRET_PATTERN =
  /(^|[\s,])(--(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key|session[-_]?key|authorization|credential|password|passwd|secret|token))(?:(=|:)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,]+)|(\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,]+))/gim;

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;

function normalizedSensitiveName(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "");
}

function isSensitiveName(key: string): boolean {
  return SENSITIVE_NAME_PATTERN.test(normalizedSensitiveName(key));
}

function redactStringArray(values: string[], homeDir?: string): string[] {
  const redacted = values.map((value) => redactText(value, homeDir));
  for (let index = 0; index < values.length; index += 1) {
    const match = values[index].match(/^--([^=:\s]+)([=:])?(.*)$/);
    if (!match || !isSensitiveName(match[1])) continue;
    if (match[2]) {
      redacted[index] = `--${match[1]}${match[2]}[REDACTED]`;
    } else if (index + 1 < redacted.length) {
      redacted[index + 1] = "[REDACTED]";
      index += 1;
    }
  }
  return redacted;
}

function redactUrl(candidate: string): string {
  const trailing = candidate.match(/[),.;]+$/)?.[0] ?? "";
  const rawUrl = trailing ? candidate.slice(0, -trailing.length) : candidate;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username || parsed.password) {
      parsed.username = "REDACTED";
      parsed.password = parsed.password ? "REDACTED" : "";
    }
    for (const key of new Set([...parsed.searchParams.keys()])) {
      parsed.searchParams.set(key, "[REDACTED]");
    }
    if (parsed.hash.length > 1) {
      parsed.hash = "[REDACTED]";
    }
    return `${parsed.toString()}${trailing}`;
  } catch {
    return candidate;
  }
}

function redactHomePath(value: string, homeDir: string): string {
  let result = value.split(homeDir).join("~");
  result = result.split(homeDir.replaceAll("\\", "/")).join("~");
  return result.replaceAll("~\\", "~/");
}

export function redactText(value: string, homeDir?: string): string {
  let result = value.replace(
    AUTHORIZATION_PATTERN,
    (_match, scheme: string) => `${scheme} [REDACTED]`
  );
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  result = result.replace(
    CLI_SECRET_PATTERN,
    (
      _match,
      prefix: string,
      flag: string,
      joinedSeparator: string | undefined,
      spacedSeparator: string | undefined
    ) =>
      `${prefix}${flag}${joinedSeparator ?? spacedSeparator ?? "="}[REDACTED]`
  );
  result = result.replace(SENSITIVE_TEXT_KEY_PATTERN, "$1[REDACTED]");
  result = result.replace(URL_PATTERN, redactUrl);
  if (homeDir) {
    result = redactHomePath(result, homeDir);
  }
  return result;
}

export function redactReport<T>(report: T, homeDir?: string): T {
  function walk(value: unknown): unknown {
    if (typeof value === "string") return redactText(value, homeDir);
    if (Array.isArray(value)) {
      return value.every((item) => typeof item === "string")
        ? redactStringArray(value, homeDir)
        : value.map(walk);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          isSensitiveName(key) ? "[REDACTED]" : walk(item)
        ])
      );
    }
    return value;
  }

  return walk(report) as T;
}
