import type { ReadStream, WriteStream } from "node:tty";

const MINIMUM_ACCESS_KEY_LENGTH = 8;
const MAXIMUM_ACCESS_KEY_LENGTH = 1024;
const MAXIMUM_STDIN_BYTES = 16 * 1024;

export function validateAccessKeyInput(value: string): string {
  if (value.length < MINIMUM_ACCESS_KEY_LENGTH) {
    throw new Error(
      `Password must be at least ${MINIMUM_ACCESS_KEY_LENGTH} characters.`
    );
  }
  if (value.length > MAXIMUM_ACCESS_KEY_LENGTH) {
    throw new Error(
      `Password must be at most ${MAXIMUM_ACCESS_KEY_LENGTH} characters.`
    );
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new Error("Password cannot contain NUL or line-break characters.");
  }
  return value;
}

export function confirmAccessKeyInput(value: string, confirmation: string): string {
  if (value !== confirmation) {
    throw new Error("The passwords did not match.");
  }
  return validateAccessKeyInput(value);
}

export function stripFinalLineEnding(value: string): string {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n") || value.endsWith("\r")) return value.slice(0, -1);
  return value;
}

export async function readAccessKeyFromStdin(
  input: NodeJS.ReadableStream = process.stdin
): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > MAXIMUM_STDIN_BYTES) {
      throw new Error("Password input is too large.");
    }
    chunks.push(buffer);
  }
  return validateAccessKeyInput(
    stripFinalLineEnding(Buffer.concat(chunks).toString("utf8"))
  );
}

export async function readMaskedAccessKey(
  prompt: string,
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout
): Promise<string> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error(
      "An interactive terminal is required. For automation, pipe the password to `pi-web set-password --stdin`."
    );
  }

  output.write(prompt);
  const wasRaw = input.isRaw;
  const wasPaused = input.isPaused();
  input.setEncoding("utf8");
  input.setRawMode(true);
  input.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;

    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.setRawMode(Boolean(wasRaw));
      if (wasPaused) input.pause();
    };
    const finish = (result?: string, error?: Error) => {
      if (settled) return;
      settled = true;
      output.write("\n");
      cleanup();
      if (error) reject(error);
      else resolve(result ?? "");
    };
    const onEnd = () =>
      finish(undefined, new Error("Password input ended unexpectedly."));
    const onError = (error: Error) => finish(undefined, error);
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u0003") {
          finish(undefined, new Error("Password entry cancelled."));
          return;
        }
        if (character === "\b" || character === "\u007f") {
          if (value.length > 0) {
            value = Array.from(value).slice(0, -1).join("");
            output.write("\b \b");
          }
          continue;
        }
        if (character < " " || character === "\u007f") continue;
        if (value.length < MAXIMUM_ACCESS_KEY_LENGTH + 1) {
          value += character;
          output.write("*");
        }
      }
    };

    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
  });
}
