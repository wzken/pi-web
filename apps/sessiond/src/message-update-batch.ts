export class MessageUpdateBatch {
  readonly #emit: (event: Record<string, unknown>) => void;
  readonly #delayMs: number;
  readonly #pending: Record<string, unknown>[] = [];
  #timer: NodeJS.Timeout | null = null;

  constructor(
    emit: (event: Record<string, unknown>) => void,
    delayMs = 50
  ) {
    this.#emit = emit;
    this.#delayMs = delayMs;
  }

  push(event: Record<string, unknown>): void {
    this.#pending.push(event);
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), this.#delayMs);
  }

  flush(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    for (const event of this.#pending.splice(0)) {
      this.#emit(event);
    }
  }
}
