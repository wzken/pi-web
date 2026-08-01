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

const LOGIN_ATTEMPT_TTL_MS = 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPT_REMOTES = 2048;

export class AuthManager {
  readonly #client: SessiondClient;
  readonly #sessions = new Map<string, LoginSession>();
  readonly #attempts = new Map<string, AttemptState>();
  readonly #attemptQueues = new Map<string, Promise<void>>();
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #verify: typeof verifyAccessKey;
  #mutationQueue: Promise<void> = Promise.resolve();
  #storedHash: StoredKeyHash | null = null;
  #keyFingerprint = "";
  #generation = 1;
  #environmentManaged = false;
  #config: PiWebConfig;

  constructor(
    client: SessiondClient,
    config: PiWebConfig,
    sleep: (milliseconds: number) => Promise<void> = async (milliseconds) =>
      await new Promise((resolve) => setTimeout(resolve, milliseconds)),
    verify: typeof verifyAccessKey = verifyAccessKey
  ) {
    this.#client = client;
    this.#config = config;
    this.#sleep = sleep;
    this.#verify = verify;
  }

  async initialize(): Promise<{ generatedKey: string | null }> {
    return await this.#mutate(async () => await this.#initialize());
  }

  async #initialize(): Promise<{ generatedKey: string | null }> {
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
    pruneLoginAttempts(this.#attempts, Date.now(), remote);
    const state = this.#attempts.get(remote) ?? { failures: 0, lastFailure: 0 };
    const delayMs = Math.min(3000, state.failures * state.failures * 150);
    if (delayMs > 0) {
      await this.#sleep(delayMs);
    }
    const storedHash = this.#storedHash;
    const keyFingerprint = this.#keyFingerprint;
    const generation = this.#generation;
    const valid =
      !!storedHash &&
      key.length <= 1024 &&
      (await this.#verify(key, storedHash));
    return await this.#mutate(async () => {
      const accepted =
        valid &&
        generation === this.#generation &&
        keyFingerprint === this.#keyFingerprint;
      await this.#client
        .request("audit.login", { success: accepted, remote })
        .catch(() => undefined);
      if (!accepted) {
        pruneLoginAttempts(this.#attempts, Date.now(), remote);
        this.#attempts.set(remote, {
          failures: Math.min(20, state.failures + 1),
          lastFailure: Date.now()
        });
        throw new PiWebError(
          "INVALID_ACCESS_KEY",
          "Access key is incorrect",
          401
        );
      }
      this.#attempts.delete(remote);
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      this.#sessions.set(tokenHash, {
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        generation: this.#generation
      });
      try {
        await this.#persistSessions();
      } catch (error) {
        this.#sessions.delete(tokenHash);
        throw error;
      }
      return { token, delayMs };
    });
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
        void this.#mutate(async () => {
          const current = this.#sessions.get(tokenHash);
          if (
            current &&
            (current.generation !== this.#generation ||
              current.expiresAt <= Date.now())
          ) {
            this.#sessions.delete(tokenHash);
            await this.#persistSessions();
          }
        }).catch(() => undefined);
      }
      return false;
    }
    return true;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.#mutate(async () => {
      const tokenHash = hashSessionToken(token);
      const session = this.#sessions.get(tokenHash);
      if (!session) return;
      this.#sessions.delete(tokenHash);
      try {
        await this.#persistSessions();
      } catch (error) {
        this.#sessions.set(tokenHash, session);
        throw error;
      }
    });
  }

  async reset(): Promise<string> {
    return await this.#mutate(async () => {
      if (this.#environmentManaged) {
        throw new PiWebError(
          "ACCESS_KEY_ENV_MANAGED",
          "The access key is managed by PI_WEB_ACCESS_KEY; change that environment value and restart the server",
          409
        );
      }
      const key = generateAccessKey();
      const storedHash = await hashAccessKey(key);
      await this.#client.rotateAccessKey({
        hash: storedHash,
        auditType: "access_key.reset",
        actor: "web"
      });
      this.#storedHash = storedHash;
      this.#keyFingerprint = fingerprintStoredHash(storedHash);
      this.#generation = nextLoginSessionGeneration(this.#generation);
      this.#sessions.clear();
      return key;
    });
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
      this.#generation = nextLoginSessionGeneration(
        persisted?.generation
      );
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

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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

export function pruneLoginAttempts(
  attempts: Map<string, { failures: number; lastFailure: number }>,
  now: number,
  incomingRemote: string
): void {
  for (const [remote, state] of attempts) {
    if (now - state.lastFailure > LOGIN_ATTEMPT_TTL_MS) {
      attempts.delete(remote);
    }
  }
  if (attempts.has(incomingRemote)) return;
  const entriesToRemove =
    attempts.size - (MAX_LOGIN_ATTEMPT_REMOTES - 1);
  if (entriesToRemove <= 0) return;
  const oldest = [...attempts.entries()]
    .sort((left, right) => left[1].lastFailure - right[1].lastFailure)
    .slice(0, entriesToRemove);
  for (const [remote] of oldest) attempts.delete(remote);
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

function nextLoginSessionGeneration(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    return 1;
  }
  return value + 1;
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
