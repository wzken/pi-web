import type { RealtimeEvent } from "@pi-web/protocol";

export class SessionEventBuffer {
  readonly #capacity: number;
  readonly #events = new Map<string, RealtimeEvent[]>();

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  append(event: RealtimeEvent): void {
    const list = this.#events.get(event.sessionId) ?? [];
    list.push(event);
    if (list.length > this.#capacity) {
      list.splice(0, list.length - this.#capacity);
    }
    this.#events.set(event.sessionId, list);
  }

  replay(
    sessionId: string,
    afterSequence: number
  ): { available: boolean; events: RealtimeEvent[] } {
    const list = this.#events.get(sessionId) ?? [];
    if (list.length === 0) return { available: afterSequence === 0, events: [] };
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
    return this.#events.get(sessionId)?.at(-1)?.sequence ?? 0;
  }
}
