import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { encodeJsonl, LfJsonlDecoder } from "@pi-web/pi-rpc";
import {
  isInternalMessage,
  maxPromptRequestBytes,
  type InternalResponse,
  type RealtimeEvent
} from "@pi-web/protocol";
import { PiWebError } from "@pi-web/shared";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class SessiondClient extends EventEmitter {
  readonly #socketPath: string;
  readonly #tokenFile: string;
  readonly #pending = new Map<string, Pending>();
  #socket: Socket | null = null;
  #authToken: string | null = null;
  #connecting: Promise<void> | null = null;
  #stopped = false;
  #retryMs = 250;
  #reconnectTimer: NodeJS.Timeout | null = null;

  constructor(socketPath: string, tokenFile: string) {
    super();
    this.#socketPath = socketPath;
    this.#tokenFile = tokenFile;
  }

  async start(): Promise<void> {
    await this.#connect();
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 20_000
  ): Promise<T> {
    await this.#connect();
    const socket = this.#socket;
    if (!socket?.writable) {
      throw new PiWebError("SESSIOND_UNAVAILABLE", "Session daemon is unavailable", 503);
    }
    const id = randomUUID();
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new PiWebError("SESSIOND_TIMEOUT", "Session daemon request timed out", 504));
      }, timeoutMs);
      timer.unref();
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      socket.write(
        encodeJsonl({
          kind: "request",
          id,
          method,
          ...(params === undefined ? {} : { params }),
          auth: {
            role: "server",
            token: this.#authToken
          }
        }),
        (error) => {
          if (!error) return;
          clearTimeout(timer);
          this.#pending.delete(id);
          reject(error);
        }
      );
    });
  }

  stop(): void {
    this.#stopped = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#socket?.destroy();
    this.#socket = null;
    this.#authToken = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PiWebError("SESSIOND_UNAVAILABLE", "Session daemon disconnected", 503));
    }
    this.#pending.clear();
  }

  async #connect(): Promise<void> {
    if (this.#socket?.writable) return;
    if (this.#stopped) {
      throw new PiWebError("SESSIOND_UNAVAILABLE", "Session daemon client is stopped", 503);
    }
    if (this.#connecting) return await this.#connecting;
    this.#connecting = this.#openConnection();
    return await this.#connecting.finally(() => {
      this.#connecting = null;
    });
  }

  async #openConnection(): Promise<void> {
    const authToken = (await readFile(this.#tokenFile, "utf8")).trim();
    if (!authToken) {
      throw new PiWebError(
        "SESSIOND_AUTH_UNAVAILABLE",
        "Session daemon authentication is unavailable",
        503
      );
    }
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.#socketPath);
      const decoder = new LfJsonlDecoder({
        maxLineBytes: maxPromptRequestBytes,
        onValue: (value) => this.#handleValue(value),
        onError: (error) => this.emit("protocolError", error)
      });
      socket.setNoDelay(true);
      socket.on("data", (chunk) => decoder.push(chunk));
      socket.on("end", () => decoder.end());
      socket.once("connect", () => {
        if (this.#reconnectTimer) {
          clearTimeout(this.#reconnectTimer);
          this.#reconnectTimer = null;
        }
        this.#socket = socket;
        this.#authToken = authToken;
        this.#retryMs = 250;
        this.emit("connect");
        resolve();
      });
      socket.once("error", reject);
      socket.on("close", () => {
        if (this.#socket === socket) this.#socket = null;
        if (this.#socket === null) this.#authToken = null;
        this.#rejectPending();
        this.emit("disconnect");
        if (!this.#stopped) this.#scheduleReconnect();
      });
    });
  }

  #handleValue(value: unknown): void {
    if (!isInternalMessage(value)) return;
    if (value.kind === "event") {
      this.emit("event", value.event as RealtimeEvent);
      return;
    }
    if (value.kind !== "response") return;
    const response = value as InternalResponse;
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else {
      pending.reject(
        new PiWebError(
          response.error?.code ?? "SESSIOND_ERROR",
          response.error?.message ?? "Session daemon request failed",
          400,
          response.error?.details
        )
      );
    }
  }

  #rejectPending(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PiWebError("SESSIOND_DISCONNECTED", "Session daemon disconnected", 503));
    }
    this.#pending.clear();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return;
    const delay = this.#retryMs;
    this.#retryMs = Math.min(5000, this.#retryMs * 2);
    const timer = setTimeout(() => {
      if (this.#reconnectTimer === timer) this.#reconnectTimer = null;
      void this.#connect().catch(() => this.#scheduleReconnect());
    }, delay);
    this.#reconnectTimer = timer;
    timer.unref();
  }
}
