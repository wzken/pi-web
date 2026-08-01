interface PendingMutation {
  fingerprint: string;
  id: string;
}

export class PendingMutationTracker {
  #pending: PendingMutation | null = null;

  constructor(
    readonly generateId: () => string = createMutationId
  ) {}

  reserve(payload: unknown): string {
    const fingerprint = JSON.stringify(payload) ?? "undefined";
    if (
      this.#pending === null ||
      this.#pending.fingerprint !== fingerprint
    ) {
      this.#pending = {
        fingerprint,
        id: this.generateId()
      };
    }
    return this.#pending.id;
  }

  confirm(id: string): void {
    if (this.#pending?.id === id) this.#pending = null;
  }
}

export function createMutationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20)
  ].join("-");
}
