import type { SessionStatus } from "@pi-web/protocol";
import { PiWebError } from "./errors.js";

const transitions: Record<SessionStatus, ReadonlySet<SessionStatus>> = {
  starting: new Set(["running", "waiting", "stopping", "failed", "interrupted", "closed"]),
  running: new Set(["waiting", "stopping", "failed", "interrupted"]),
  waiting: new Set(["running", "stopping", "failed", "interrupted", "closed"]),
  stopping: new Set(["waiting", "failed", "interrupted", "closed"]),
  failed: new Set(["starting", "closed"]),
  interrupted: new Set(["starting", "closed"]),
  closed: new Set(["starting"])
};

export function canTransition(
  from: SessionStatus,
  to: SessionStatus
): boolean {
  return from === to || (transitions[from]?.has(to) ?? false);
}

export function assertTransition(
  from: SessionStatus,
  to: SessionStatus
): void {
  if (!canTransition(from, to)) {
    throw new PiWebError(
      "INVALID_SESSION_TRANSITION",
      `Invalid session transition: ${from} -> ${to}`,
      409
    );
  }
}
