import { PiWebError } from "@pi-web/shared";

export class TransientMutationDeduper {
  readonly #pending = new Map<
    string,
    { fingerprint: string; result: Promise<unknown> }
  >();
  readonly #accepted = new Map<
    string,
    { fingerprint: string; value: unknown }
  >();

  constructor(
    readonly maxPending = 128,
    readonly maxAccepted = 512
  ) {}

  async run<T>(
    key: string,
    fingerprint: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const accepted = this.#accepted.get(key);
    if (accepted) {
      assertSameFingerprint(accepted.fingerprint, fingerprint);
      return accepted.value as T;
    }
    const pending = this.#pending.get(key);
    if (pending) {
      assertSameFingerprint(pending.fingerprint, fingerprint);
      return pending.result as Promise<T>;
    }
    if (this.#pending.size >= this.maxPending) {
      throw new PiWebError(
        "MUTATION_LIMIT",
        "Too many session mutations are pending",
        429
      );
    }

    const result = operation();
    this.#pending.set(key, { fingerprint, result });
    try {
      const value = await result;
      this.#accepted.set(key, { fingerprint, value });
      while (this.#accepted.size > this.maxAccepted) {
        const oldest = this.#accepted.keys().next().value as
          | string
          | undefined;
        if (oldest === undefined) break;
        this.#accepted.delete(oldest);
      }
      return value;
    } finally {
      if (this.#pending.get(key)?.result === result) {
        this.#pending.delete(key);
      }
    }
  }
}

function assertSameFingerprint(
  accepted: string,
  incoming: string
): void {
  if (accepted === incoming) return;
  throw new PiWebError(
    "MUTATION_ID_REUSED",
    "Mutation ID was already used for a different payload",
    409
  );
}
