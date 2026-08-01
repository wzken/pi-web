export class MessageUpdateBatch {
  static readonly maxTextCharacters = 256 * 1024;
  readonly #emit: (event: Record<string, unknown>) => void;
  readonly #delayMs: number;
  #pendingText = "";
  #timer: NodeJS.Timeout | null = null;

  constructor(
    emit: (event: Record<string, unknown>) => void,
    delayMs = 50
  ) {
    this.#emit = emit;
    this.#delayMs = delayMs;
  }

  push(text: string): void {
    if (!text) return;
    let remaining = text;
    while (remaining) {
      const capacity =
        MessageUpdateBatch.maxTextCharacters - this.#pendingText.length;
      if (capacity === 0) {
        this.flush();
        continue;
      }
      this.#pendingText += remaining.slice(0, capacity);
      remaining = remaining.slice(capacity);
      if (
        this.#pendingText.length === MessageUpdateBatch.maxTextCharacters
      ) {
        this.flush();
      }
    }
    if (!this.#pendingText) return;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), this.#delayMs);
  }

  flush(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#pendingText) return;
    const text = this.#pendingText;
    this.#pendingText = "";
    this.#emit({ type: "message_update", delta: { text } });
  }
}
