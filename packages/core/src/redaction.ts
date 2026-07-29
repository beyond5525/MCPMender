const SECRET_KEY_PATTERN =
  /(["']?(?:token|secret|password|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)([^"',\s}]+)/gi;

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi
];

export function redactText(value: string, homeDir?: string): string {
  let result = value.replace(SECRET_KEY_PATTERN, "$1[REDACTED]");
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  if (homeDir) {
    result = result.split(homeDir).join("~");
    result = result.split(homeDir.replaceAll("\\", "/")).join("~");
  }
  return result;
}

export function redactReport<T>(report: T, homeDir?: string): T {
  function walk(value: unknown): unknown {
    if (typeof value === "string") return redactText(value, homeDir);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, walk(item)])
      );
    }
    return value;
  }

  return walk(report) as T;
}
