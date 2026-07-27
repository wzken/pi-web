export function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(extractText).join("");
  const record = value as Record<string, unknown>;
  for (const key of ["text", "delta", "contentDelta", "assistantMessageEvent"]) {
    if (record[key] !== undefined) {
      const result = extractText(record[key]);
      if (result) return result;
    }
  }
  return "";
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
