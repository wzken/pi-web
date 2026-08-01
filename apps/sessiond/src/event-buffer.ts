import type { RealtimeEvent } from "@pi-web/protocol";

interface BufferedEvent {
  event: RealtimeEvent;
  bytes: number;
}

interface SessionEvents {
  entries: BufferedEvent[];
  bytes: number;
  latestSequence: number;
}

export interface EventBufferEviction {
  sessionId: string;
  latestSequence: number;
}

export class SessionEventBuffer {
  readonly #capacity: number;
  readonly #maxSessions: number;
  readonly #maxBytesPerSession: number;
  readonly #events = new Map<string, SessionEvents>();

  constructor(
    capacity: number,
    maxSessions = 128,
    maxBytesPerSession = 2 * 1024 * 1024
  ) {
    this.#capacity = capacity;
    this.#maxSessions = maxSessions;
    this.#maxBytesPerSession = maxBytesPerSession;
  }

  append(event: RealtimeEvent): EventBufferEviction | null {
    const existing = this.#events.get(event.sessionId);
    const sessionEvents = existing ?? {
      entries: [],
      bytes: 0,
      latestSequence: 0
    };
    if (existing) this.#events.delete(event.sessionId);
    const buffered = { event, bytes: eventBytes(event) };
    sessionEvents.latestSequence = event.sequence;
    if (buffered.bytes > this.#maxBytesPerSession) {
      sessionEvents.entries = [];
      sessionEvents.bytes = 0;
    } else {
      sessionEvents.entries.push(buffered);
      sessionEvents.bytes += buffered.bytes;
      while (
        sessionEvents.entries.length > this.#capacity ||
        sessionEvents.bytes > this.#maxBytesPerSession
      ) {
        sessionEvents.bytes -= sessionEvents.entries.shift()!.bytes;
      }
    }
    this.#events.set(event.sessionId, sessionEvents);
    let eviction: EventBufferEviction | null = null;
    while (this.#events.size > this.#maxSessions) {
      const sessionId = this.#events.keys().next().value!;
      const evicted = this.#events.get(sessionId)!;
      this.#events.delete(sessionId);
      eviction = { sessionId, latestSequence: evicted.latestSequence };
    }
    return eviction;
  }

  replay(
    sessionId: string,
    afterSequence: number
  ): { available: boolean; events: RealtimeEvent[] } {
    const sessionEvents = this.#events.get(sessionId);
    const list =
      sessionEvents?.entries.map((entry) => entry.event) ?? [];
    if (list.length === 0) {
      return {
        available:
          sessionEvents === undefined
            ? afterSequence === 0
            : afterSequence >= sessionEvents.latestSequence,
        events: []
      };
    }
    const first = list[0]!.sequence;
    if (afterSequence < first - 1) return { available: false, events: [] };
    return {
      available: true,
      events: list.filter((event) => event.sequence > afterSequence)
    };
  }

  clear(sessionId: string): void {
    this.#events.delete(sessionId);
  }

  latestSequence(sessionId: string): number {
    return this.#events.get(sessionId)?.latestSequence ?? 0;
  }
}

function eventBytes(event: RealtimeEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
