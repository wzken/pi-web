export class PiWebError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "PiWebError";
  }
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
