import type { FastifyReply } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import { createHash } from "node:crypto";
import {
  generateAccessKey,
  generateSessionToken,
  hashAccessKey,
  PiWebError,
  verifyAccessKey,
  type StoredKeyHash
} from "@pi-web/shared";
import { SessiondClient } from "./sessiond-client.js";

interface LoginSession {
  expiresAt: number;
  generation: number;
}

interface PersistedLoginSessions {
  version: 1;
  keyFingerprint: string;
  generation: number;
  sessions: Array<{
    tokenHash: string;
    expiresAt: number;
    generation: number;
  }>;
}

interface AttemptState {
  failures: number;
  lastFailure: number;
}

export class AuthManager {
  readonly #client: SessiondClient;
  readonly #sessions = new Map<string, LoginSession>();
  readonly #attempts = new Map<string, AttemptState>();
  readonly #attemptQueues = new Map<string, Promise<void>>();
  readonly #sleep: (milliseconds: number) => Promise<void>;
  #storedHash: StoredKeyHash | null = null;
  #keyFingerprint = "";
  #generation = 1;
  #environmentManaged = false;
  #config: PiWebConfig;

  constructor(
    client: SessiondClient,
    config: PiWebConfig,
    sleep: (milliseconds: number) => Promise<void> = async (milliseconds) =>
      await new Promise((resolve) => setTimeout(resolve, milliseconds))
  ) {
    this.#client = client;
    this.#config = config;
    this.#sleep = sleep;
  }

  async initialize(): Promise<{ generatedKey: string | null }> {
    const environmentKey = process.env.PI_WEB_ACCESS_KEY;
    if (environmentKey) {
      this.#environmentManaged = true;
      this.#storedHash = await hashAccessKey(environmentKey);
      this.#keyFingerprint = fingerprint(environmentKey);
      await this.#restoreSessions();
      return { generatedKey: null };
    }
    const persisted = await this.#client.request<StoredKeyHash | null>(
      "auth.get_hash"
    );
    let generatedKey: string | null = null;
    if (persisted) this.#storedHash = persisted;
    else {
      generatedKey = generateAccessKey();
      this.#storedHash = await hashAccessKey(generatedKey);
      await this.#client.request("auth.set_hash", { hash: this.#storedHash });
    }
    this.#keyFingerprint = fingerprintStoredHash(this.#storedHash);
    await this.#restoreSessions();
    return { generatedKey };
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  async login(
    key: string,
    remote: string
  ): Promise<{ token: string; delayMs: number }> {
    const previous = this.#attemptQueues.get(remote) ?? Promise.resolve();
    const attempt = previous.then(() => this.#performLogin(key, remote));
    const tail = attempt.then(
      () => undefined,
      () => undefined
    );
    this.#attemptQueues.set(remote, tail);
    try {
      return await attempt;
    } finally {
      if (this.#attemptQueues.get(remote) === tail) {
        this.#attemptQueues.delete(remote);
      }
    }
  }

  async #performLogin(
    key: string,
    remote: string
  ): Promise<{ token: string; delayMs: number }> {
    const state = this.#attempts.get(remote) ?? { failures: 0, lastFailure: 0 };
    const delayMs = Math.min(3000, state.failures * state.failures * 150);
    if (delayMs > 0) {
      await this.#sleep(delayMs);
    }
    const valid =
      !!this.#storedHash &&
      key.length <= 1024 &&
      (await verifyAccessKey(key, this.#storedHash));
    await this.#client
      .request("audit.login", { success: valid, remote })
      .catch(() => undefined);
    if (!valid) {
      this.#attempts.set(remote, {
        failures: Math.min(20, state.failures + 1),
        lastFailure: Date.now()
      });
      throw new Error("Invalid access key");
    }
    this.#attempts.delete(remote);
    const token = generateSessionToken();
    this.#sessions.set(hashSessionToken(token), {
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      generation: this.#generation
    });
    await this.#persistSessions();
    return { token, delayMs };
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const tokenHash = hashSessionToken(token);
    const session = this.#sessions.get(tokenHash);
    if (
      !session ||
      session.generation !== this.#generation ||
      session.expiresAt <= Date.now()
    ) {
      if (session) {
        this.#sessions.delete(tokenHash);
        void this.#persistSessions().catch(() => undefined);
      }
      return false;
    }
    return true;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    if (this.#sessions.delete(hashSessionToken(token))) {
      await this.#persistSessions();
    }
  }

  async reset(): Promise<string> {
    if (this.#environmentManaged) {
      throw new PiWebError(
        "ACCESS_KEY_ENV_MANAGED",
        "The access key is managed by PI_WEB_ACCESS_KEY; change that environment value and restart the server",
        409
      );
    }
    const key = generateAccessKey();
    this.#storedHash = await hashAccessKey(key);
    this.#keyFingerprint = fingerprintStoredHash(this.#storedHash);
    this.#generation += 1;
    this.#sessions.clear();
    await this.#client.request("auth.set_hash", { hash: this.#storedHash });
    await this.#persistSessions();
    return key;
  }

  async #restoreSessions(): Promise<void> {
    const persisted =
      await this.#client.request<PersistedLoginSessions | null>(
        "auth.get_sessions"
      );
    if (
      !isPersistedLoginSessions(persisted) ||
      persisted.keyFingerprint !== this.#keyFingerprint
    ) {
      this.#generation = Math.max(1, (persisted?.generation ?? 0) + 1);
      this.#sessions.clear();
      await this.#persistSessions();
      return;
    }
    this.#generation = persisted.generation;
    const now = Date.now();
    for (const session of persisted.sessions) {
      if (
        session.generation === this.#generation &&
        session.expiresAt > now
      ) {
        this.#sessions.set(session.tokenHash, {
          expiresAt: session.expiresAt,
          generation: session.generation
        });
      }
    }
    if (this.#sessions.size !== persisted.sessions.length) {
      await this.#persistSessions();
    }
  }

  async #persistSessions(): Promise<void> {
    const state: PersistedLoginSessions = {
      version: 1,
      keyFingerprint: this.#keyFingerprint,
      generation: this.#generation,
      sessions: Array.from(this.#sessions, ([tokenHash, session]) => ({
        tokenHash,
        expiresAt: session.expiresAt,
        generation: session.generation
      }))
    };
    await this.#client.request("auth.set_sessions", { sessions: state });
  }

  setCookie(reply: FastifyReply, token: string, secure: boolean): void {
    reply.setCookie("pi_web_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 14 * 24 * 60 * 60
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie("pi_web_session", {
      httpOnly: true,
      sameSite: "strict",
      secure: this.#config.cookieSecure === "always",
      path: "/"
    });
  }
}

export function shouldUseSecureCookie(
  config: PiWebConfig,
  protocol: string
): boolean {
  if (config.cookieSecure === "always") return true;
  if (config.cookieSecure === "never") return false;
  return protocol === "https";
}

function hashSessionToken(token: string): string {
  return fingerprint(token);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function fingerprintStoredHash(stored: StoredKeyHash): string {
  return fingerprint(`${stored.algorithm}:${stored.salt}:${stored.hash}`);
}

function isPersistedLoginSessions(
  value: PersistedLoginSessions | null
): value is PersistedLoginSessions {
  return (
    value?.version === 1 &&
    typeof value.keyFingerprint === "string" &&
    Number.isSafeInteger(value.generation) &&
    value.generation > 0 &&
    Array.isArray(value.sessions) &&
    value.sessions.every(
      (session) =>
        typeof session?.tokenHash === "string" &&
        Number.isFinite(session.expiresAt) &&
        Number.isSafeInteger(session.generation)
    )
  );
}
