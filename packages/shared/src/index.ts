export * from "./auth.js";
export * from "./errors.js";
export * from "./paths.js";
export * from "./state-machine.js";
export * from "./redact.js";

export function nowIso(): string {
  return new Date().toISOString();
}
