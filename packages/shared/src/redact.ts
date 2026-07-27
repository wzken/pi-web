const sensitiveKey = /(?:access.?key|api.?key|token|secret|password|authorization|cookie)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[redacted]" : redact(item, depth + 1)
    ])
  );
}
