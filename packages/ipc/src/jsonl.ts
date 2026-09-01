export interface JsonlDecoderOptions {
  maxLineBytes?: number;
  onValue: (value: unknown) => void;
  onError: (error: Error, raw: string) => void;
}

/**
 * Pi RPC uses LF as its only delimiter. TextDecoder preserves U+2028/U+2029 as
 * ordinary JSON string content, unlike Node's readline implementation.
 */
export class LfJsonlDecoder {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  readonly #maxLineBytes: number;
  readonly #onValue: (value: unknown) => void;
  readonly #onError: (error: Error, raw: string) => void;
  #buffer = "";
  #bufferBytes = 0;
  #discardingOversizedRecord = false;

  constructor(options: JsonlDecoderOptions) {
    this.#maxLineBytes = options.maxLineBytes ?? 16 * 1024 * 1024;
    this.#onValue = options.onValue;
    this.#onError = options.onError;
  }

  push(chunk: Uint8Array): void {
    let decoded: string;
    try {
      decoded = this.#decoder.decode(chunk, { stream: true });
    } catch (error) {
      this.#onError(
        error instanceof Error ? error : new Error(String(error)),
        this.#buffer
      );
      this.#buffer = "";
      this.#bufferBytes = 0;
      return;
    }

    this.#buffer += decoded;
    this.#bufferBytes += chunk.byteLength;
    this.#drain(false);
  }

  end(): void {
    try {
      this.#buffer += this.#decoder.decode();
    } catch (error) {
      this.#onError(
        error instanceof Error ? error : new Error(String(error)),
        this.#buffer
      );
      this.#buffer = "";
      this.#bufferBytes = 0;
      return;
    }
    this.#drain(true);
  }

  #drain(final: boolean): void {
    if (this.#discardingOversizedRecord) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) {
        this.#buffer = "";
        this.#bufferBytes = 0;
        return;
      }
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#bufferBytes = Buffer.byteLength(this.#buffer);
      this.#discardingOversizedRecord = false;
    }

    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const raw = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#bufferBytes = Buffer.byteLength(this.#buffer);
      if (Buffer.byteLength(raw) > this.#maxLineBytes) {
        this.#reportOversizedRecord(raw);
      } else if (raw.length > 0) {
        this.#parse(raw);
      }
      newline = this.#buffer.indexOf("\n");
    }

    if (this.#bufferBytes > this.#maxLineBytes) {
      this.#reportOversizedRecord(this.#buffer);
      this.#buffer = "";
      this.#bufferBytes = 0;
      this.#discardingOversizedRecord = true;
    }

    if (
      final &&
      !this.#discardingOversizedRecord &&
      this.#buffer.length > 0
    ) {
      const raw = this.#buffer.replace(/\r$/, "");
      this.#buffer = "";
      this.#bufferBytes = 0;
      this.#onError(new Error("Incomplete JSONL record at end of stream"), raw);
    }
  }

  #reportOversizedRecord(raw: string): void {
    this.#onError(
      new Error(`JSONL record exceeds ${this.#maxLineBytes} bytes`),
      raw.slice(0, 1024)
    );
  }

  #parse(raw: string): void {
    try {
      this.#onValue(JSON.parse(raw));
    } catch (error) {
      this.#onError(
        error instanceof Error ? error : new Error(String(error)),
        raw
      );
    }
  }
}

export function encodeJsonl(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
