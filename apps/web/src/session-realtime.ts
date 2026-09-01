import type {
  ProjectionCursor,
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";

export function resolveProjectionCursor(
  stored: string | null,
  fallback: ProjectionCursor
): ProjectionCursor {
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored) as Partial<ProjectionCursor>;
    if (
      typeof parsed.projectionEpoch === "string" &&
      Number.isSafeInteger(parsed.sequence) &&
      (parsed.sequence ?? -1) >= 0
    ) {
      if (parsed.projectionEpoch !== fallback.projectionEpoch) {
        return fallback;
      }
      return {
        projectionEpoch: fallback.projectionEpoch,
        sequence: Math.max(parsed.sequence ?? 0, fallback.sequence)
      };
    }
  } catch {
    // Invalid browser resume metadata is discarded below.
  }
  return fallback;
}

export const sessionProjectionResetCloseCode = 1012;
export const sessionHeartbeatIntervalMs = 15_000;
export const sessionHeartbeatTimeoutMs = 8_000;

const projectionRecoveryDelays = [500, 1_000, 2_000, 4_000, 5_000] as const;

export function projectionRecoveryDelay(
  failedAttempts: number
): number | null {
  return projectionRecoveryDelays[failedAttempts] ?? null;
}

export function shouldRefreshProjectionAfterDisconnect(
  projectionReset: boolean,
  visibilityState: DocumentVisibilityState
): boolean {
  return projectionReset || visibilityState === "visible";
}

export function isNewerSequence(
  latest: number,
  incoming: number
): boolean {
  return (
    Number.isSafeInteger(incoming) &&
    incoming >= 0 &&
    incoming > latest
  );
}

export type SequenceDisposition = "next" | "stale" | "gap";

export function classifySequence(
  latest: number,
  incoming: number
): SequenceDisposition {
  if (!isNewerSequence(latest, incoming)) return "stale";
  return incoming === latest + 1 ? "next" : "gap";
}

export function orderRealtimeEvents(
  events: RealtimeEvent[]
): RealtimeEvent[] {
  const bySequence = new Map<number, RealtimeEvent>();
  for (const event of events) {
    if (!bySequence.has(event.sequence)) {
      bySequence.set(event.sequence, event);
    }
  }
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence
  );
}

export function mergeSynchronizedEvents(
  synchronizedEvents: RealtimeEvent[],
  bufferedEvents: RealtimeEvent[]
): RealtimeEvent[] {
  return orderRealtimeEvents([...synchronizedEvents, ...bufferedEvents]);
}

type TimerHandle = ReturnType<typeof setTimeout>;

interface SessionHeartbeatOptions {
  sendPing: () => void;
  onTimeout: () => void;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export interface SessionHeartbeat {
  start(): void;
  acknowledge(): void;
  stop(): void;
}

export function createSessionHeartbeat({
  sendPing,
  onTimeout,
  schedule = setTimeout,
  cancel = clearTimeout
}: SessionHeartbeatOptions): SessionHeartbeat {
  let stopped = true;
  let heartbeatTimer: TimerHandle | null = null;
  let timeoutTimer: TimerHandle | null = null;

  const clearHeartbeatTimer = () => {
    if (heartbeatTimer !== null) cancel(heartbeatTimer);
    heartbeatTimer = null;
  };
  const clearTimeoutTimer = () => {
    if (timeoutTimer !== null) cancel(timeoutTimer);
    timeoutTimer = null;
  };
  const scheduleHeartbeat = () => {
    clearHeartbeatTimer();
    if (stopped) return;
    heartbeatTimer = schedule(() => {
      heartbeatTimer = null;
      if (stopped) return;
      sendPing();
      clearTimeoutTimer();
      timeoutTimer = schedule(() => {
        timeoutTimer = null;
        if (!stopped) {
          stopped = true;
          clearHeartbeatTimer();
          onTimeout();
        }
      }, sessionHeartbeatTimeoutMs);
    }, sessionHeartbeatIntervalMs);
  };

  return {
    start() {
      stopped = false;
      clearTimeoutTimer();
      scheduleHeartbeat();
    },
    acknowledge() {
      if (stopped) return;
      clearTimeoutTimer();
      scheduleHeartbeat();
    },
    stop() {
      stopped = true;
      clearHeartbeatTimer();
      clearTimeoutTimer();
    }
  };
}

export function parseSessionSocketMessage(
  data: unknown
): ParsedSessionSocketMessage | null {
  if (typeof data !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    value.type === "sync" &&
    value.mode === "snapshot" &&
    isSessionSnapshot(value.snapshot)
  ) {
    return { type: "snapshot", snapshot: value.snapshot };
  }
  if (
    value.type === "sync" &&
    value.mode === "incremental" &&
    Array.isArray(value.events)
  ) {
    return {
      type: "incremental",
      events: value.events.filter(isRealtimeEvent)
    };
  }
  if (value.type === "event" && isRealtimeEvent(value.event)) {
    return { type: "event", event: value.event };
  }
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message };
  }
  if (
    value.type === "pong" &&
    typeof value.at === "number" &&
    Number.isFinite(value.at)
  ) {
    return { type: "pong", at: value.at };
  }
  return null;
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!isRecord(value) || !isRecord(value.session)) return false;
  return (
    typeof value.session.id === "string" &&
    typeof value.projectionEpoch === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0
  );
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === "string" &&
    typeof value.projectionEpoch === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) >= 0 &&
    typeof value.type === "string" &&
    typeof value.timestamp === "string" &&
    "payload" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type ParsedSessionSocketMessage =
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "incremental"; events: RealtimeEvent[] }
  | { type: "event"; event: RealtimeEvent }
  | { type: "error"; message: string }
  | { type: "pong"; at: number };
