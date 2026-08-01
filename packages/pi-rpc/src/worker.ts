import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { PromptImage, ThinkingLevel } from "@pi-web/protocol";
import { PiWebError, redact, safeErrorMessage } from "@pi-web/shared";
import { encodeJsonl, LfJsonlDecoder } from "./jsonl.js";

export interface PiRpcWorkerOptions {
  executable: string;
  prefixArgs?: string[];
  cwd: string;
  name: string;
  sessionPath?: string | null;
  model?: string | null;
  thinkingLevel?: ThinkingLevel | null;
  systemPrompt?: string | null;
  extensionPath?: string | null;
  noSession?: boolean;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  maxLineBytes?: number;
}

export interface PiRpcResponse {
  type: "response";
  command: string;
  success: boolean;
  id?: string;
  data?: unknown;
  error?: string;
}

interface Pending {
  resolve: (response: PiRpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PiRpcWorker extends EventEmitter {
  readonly #options: PiRpcWorkerOptions;
  readonly #pending = new Map<string, Pending>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #state: Record<string, unknown> | null = null;
  #stderr = "";
  #intentionalStop = false;
  #closePromise: Promise<void> | null = null;

  constructor(options: PiRpcWorkerOptions) {
    super();
    this.#options = options;
  }

  get pid(): number | null {
    return this.#process?.pid ?? null;
  }

  get state(): Record<string, unknown> | null {
    return this.#state;
  }

  get sessionFile(): string | null {
    return typeof this.#state?.sessionFile === "string"
      ? this.#state.sessionFile
      : null;
  }

  get stderrTail(): string {
    return this.#stderr.slice(-8192);
  }

  async start(): Promise<Record<string, unknown>> {
    if (this.#process) {
      throw new PiWebError("WORKER_ALREADY_STARTED", "Pi worker is already started", 409);
    }
    const args = [...(this.#options.prefixArgs ?? []), "--mode", "rpc", "--name", this.#options.name];
    if (this.#options.noSession) args.push("--no-session");
    if (this.#options.sessionPath) args.push("--session", this.#options.sessionPath);
    if (this.#options.extensionPath) args.push("--extension", this.#options.extensionPath);
    if (this.#options.systemPrompt?.trim()) {
      args.push("--append-system-prompt", this.#options.systemPrompt.trim());
    }

    const child = spawn(this.#options.executable, args, {
      cwd: this.#options.cwd,
      env: { ...process.env, ...this.#options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    this.#process = child;

    const decoder = new LfJsonlDecoder({
      ...(this.#options.maxLineBytes === undefined
        ? {}
        : { maxLineBytes: this.#options.maxLineBytes }),
      onValue: (value) => this.#handleValue(value),
      onError: (error, raw) => {
        this.emit("protocolError", {
          message: error.message,
          sample: raw.slice(0, 512)
        });
      }
    });
    child.stdout.on("data", (chunk: Buffer) => decoder.push(chunk));
    child.stdout.on("end", () => decoder.end());
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = `${this.#stderr}${chunk.toString("utf8")}`.slice(-32_768);
      this.emit("stderr", chunk.toString("utf8"));
    });
    child.on("error", (error) => this.#handleExit(null, null, error));
    child.on("exit", (code, signal) => this.#handleExit(code, signal));

    const response = await this.send({ type: "get_state" });
    this.#state = asRecord(response.data);

    if (this.#options.model) {
      const slash = this.#options.model.indexOf("/");
      if (slash <= 0 || slash === this.#options.model.length - 1) {
        throw new PiWebError(
          "INVALID_MODEL",
          "Model must be written as provider/model-id",
          400
        );
      }
      await this.send({
        type: "set_model",
        provider: this.#options.model.slice(0, slash),
        modelId: this.#options.model.slice(slash + 1)
      });
    }
    if (this.#options.thinkingLevel) {
      await this.send({
        type: "set_thinking_level",
        level: this.#options.thinkingLevel
      });
    }
    const refreshed = await this.send({ type: "get_state" });
    this.#state = asRecord(refreshed.data);
    return this.#state;
  }

  async send(command: Record<string, unknown>): Promise<PiRpcResponse> {
    const child = this.#process;
    if (!child || child.killed || !child.stdin.writable) {
      throw new PiWebError("WORKER_NOT_RUNNING", "Pi worker is not running", 409);
    }
    const id = randomUUID();
    const request = { ...command, id };
    return await new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PiWebError("PI_RPC_TIMEOUT", "Pi RPC request timed out", 504));
      }, this.#options.requestTimeoutMs ?? 15_000);
      timer.unref();
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(encodeJsonl(request), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  prompt(
    message: string,
    behavior: "prompt" | "steer" | "follow_up" = "prompt",
    images: PromptImage[] = []
  ): Promise<PiRpcResponse> {
    const type = behavior === "follow_up" ? "follow_up" : behavior;
    return this.send({
      type,
      message,
      ...(images.length > 0 ? { images } : {})
    });
  }

  abort(): Promise<PiRpcResponse> {
    return this.send({ type: "abort" });
  }

  async refreshState(): Promise<Record<string, unknown>> {
    const response = await this.send({ type: "get_state" });
    this.#state = asRecord(response.data);
    return this.#state;
  }

  close(graceMs = 3000): Promise<void> {
    const child = this.#process;
    if (!child) return Promise.resolve();
    if (this.#closePromise) return this.#closePromise;
    this.#intentionalStop = true;
    const termination = waitForChildTermination(child, graceMs);
    const tracked = termination.finally(() => {
      if (this.#closePromise === tracked) this.#closePromise = null;
    });
    this.#closePromise = tracked;
    return tracked;
  }

  #handleValue(value: unknown): void {
    if (!value || typeof value !== "object") {
      this.emit("protocolError", { message: "RPC record is not an object" });
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "response") {
      const response = record as unknown as PiRpcResponse;
      const id = typeof response.id === "string" ? response.id : null;
      if (id) {
        const pending = this.#pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pending.delete(id);
          if (response.success) pending.resolve(response);
          else {
            pending.reject(
              new PiWebError(
                "PI_RPC_REJECTED",
                response.error || `Pi rejected ${response.command}`,
                422,
                redact(response)
              )
            );
          }
        }
      }
      this.emit("response", response);
      return;
    }
    this.emit("event", record);
  }

  #handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    cause?: Error
  ): void {
    if (!this.#process) return;
    this.#process = null;
    const error = new PiWebError(
      "PI_WORKER_EXITED",
      cause
        ? `Pi worker failed: ${safeErrorMessage(cause)}`
        : `Pi worker exited (${code ?? signal ?? "unknown"})`,
      502,
      { code, signal, stderr: this.stderrTail }
    );
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.emit("exit", {
      code,
      signal,
      intentional: this.#intentionalStop,
      stderr: this.stderrTail
    });
  }
}

function waitForChildTermination(
  child: ChildProcessWithoutNullStreams,
  graceMs: number
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = () => settle();
    const onError = () => settle();
    child.once("exit", onExit);
    child.once("error", onError);
    try {
      child.kill("SIGTERM");
    } catch (error) {
      fail(error);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      settle();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (child.exitCode !== null || child.signalCode !== null) {
        settle();
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch (error) {
        fail(error);
      }
    }, Math.max(0, graceMs));
    timer.unref();
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
