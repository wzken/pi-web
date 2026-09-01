import { PiWebError } from "@pi-web/shared";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function stringParam(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new PiWebError("INVALID_PARAMETER", `${key} is required`, 400);
  }
  return value;
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function numberParam(
  record: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  return typeof record[key] === "number" && Number.isFinite(record[key])
    ? record[key]
    : fallback;
}
