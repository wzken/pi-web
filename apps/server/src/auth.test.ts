import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import { hashAccessKey, PiWebError } from "@pi-web/shared";
import {
  AuthManager,
  maxPendingLoginAttemptsPerRemote,
  pruneLoginAttempts,
  shouldUseSecureCookie
} from "./auth.js";
import type { SessiondClient } from "@pi-web/ipc";

const config = {
  cookieSecure: "auto"
} as PiWebConfig;

describe("server authentication policy", () => {
  const savedKey = process.env.PI_WEB_ACCESS_KEY;

  afterEach(() => {
    vi.useRealTimers();
    if (savedKey === undefined) delete process.env.PI_WEB_ACCESS_KEY;
    else process.env.PI_WEB_ACCESS_KEY = savedKey;
  });

  it("sets Secure cookies according to policy and transport", () => {
    expect(shouldUseSecureCookie(config, "https")).toBe(true);
    expect(shouldUseSecureCookie(config, "http")).toBe(false);
    expect(
      shouldUseSecureCookie({ ...config, cookieSecure: "always" }, "http")
    ).toBe(true);
    expect(
      shouldUseSecureCookie({ ...config, cookieSecure: "never" }, "https")
    ).toBe(false);
  });

  it("does not pretend it can reset an environment-managed key", async () => {
    process.env.PI_WEB_ACCESS_KEY = "environment-owned-secret";
    const client = {
      request: vi.fn().mockResolvedValue(null)
    } as unknown as SessiondClient;
    const auth = new AuthManager(client);
    await auth.initialize();
    vi.mocked(client.request).mockClear();
    await expect(auth.reset()).rejects.toMatchObject({
      code: "ACCESS_KEY_ENV_MANAGED"
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("restores hashed login sessions after a server restart", async () => {
    process.env.PI_WEB_ACCESS_KEY = "persistent-secret";
    const settings = new Map<string, unknown>();
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_sessions") {
          return settings.get("auth_sessions") ?? null;
        }
        if (method === "auth.set_sessions") {
          settings.set(
            "auth_sessions",
            (params as { sessions: unknown }).sessions
          );
          return { updated: true };
        }
        return null;
      })
    } as unknown as SessiondClient;

    const first = new AuthManager(client);
    await first.initialize();
    const { token } = await first.login("persistent-secret", "127.0.0.1");
    expect(first.validate(token)).toBe(true);

    const restarted = new AuthManager(client);
    await restarted.initialize();
    expect(restarted.validate(token)).toBe(true);
    expect(JSON.stringify(settings.get("auth_sessions"))).not.toContain(token);

    await restarted.logout(token);
    const afterLogoutRestart = new AuthManager(client);
    await afterLogoutRestart.initialize();
    expect(afterLogoutRestart.validate(token)).toBe(false);
  });

  it("invalidates persisted sessions when the environment key changes", async () => {
    const settings = new Map<string, unknown>();
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_sessions") {
          return settings.get("auth_sessions") ?? null;
        }
        if (method === "auth.set_sessions") {
          settings.set(
            "auth_sessions",
            (params as { sessions: unknown }).sessions
          );
          return { updated: true };
        }
        return null;
      })
    } as unknown as SessiondClient;

    process.env.PI_WEB_ACCESS_KEY = "first-secret";
    const first = new AuthManager(client);
    await first.initialize();
    const { token } = await first.login("first-secret", "127.0.0.1");

    process.env.PI_WEB_ACCESS_KEY = "second-secret";
    const restarted = new AuthManager(client);
    await restarted.initialize();
    expect(restarted.validate(token)).toBe(false);
    expect(
      (settings.get("auth_sessions") as { generation: number }).generation
    ).toBe(2);
  });

  it.each([
    ["malformed", "not-a-number"],
    ["null", null],
    ["maximum safe integer", Number.MAX_SAFE_INTEGER],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1]
  ])(
    "self-heals a %s persisted login generation",
    async (_label, generation) => {
      process.env.PI_WEB_ACCESS_KEY = "expected-secret";
      let persisted: unknown = {
        version: 1,
        keyFingerprint: "stale-fingerprint",
        generation,
        sessions: []
      };
      const client = {
        request: vi.fn(async (method: string, params?: unknown) => {
          if (method === "auth.get_sessions") return persisted;
          if (method === "auth.set_sessions") {
            persisted = (params as { sessions: unknown }).sessions;
          }
          return null;
        })
      } as unknown as SessiondClient;
      const auth = new AuthManager(
        client,
        async () => undefined,
        async () => true
      );

      await auth.initialize();
      expect((persisted as { generation: number }).generation).toBe(1);

      const { token } = await auth.login(
        "expected-secret",
        "198.51.100.30"
      );
      expect(auth.validate(token)).toBe(true);
    }
  );

  it("keeps a key-reset generation bounded at the safe-integer limit", async () => {
    delete process.env.PI_WEB_ACCESS_KEY;
    const settings = new Map<string, unknown>([
      ["access_key_hash", await hashAccessKey("old-access-key")]
    ]);
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_hash") {
          return settings.get("access_key_hash") ?? null;
        }
        if (method === "auth.get_sessions") {
          return settings.get("auth_sessions") ?? null;
        }
        if (method === "auth.set_sessions") {
          settings.set(
            "auth_sessions",
            (params as { sessions: unknown }).sessions
          );
        }
        return null;
      }),
      rotateAccessKey: vi.fn(async (input) => {
        settings.set("access_key_hash", input.hash);
        settings.delete("auth_sessions");
        return { updated: true as const };
      })
    } as unknown as SessiondClient;
    const seed = new AuthManager(
      client,
      async () => undefined,
      async () => true
    );
    await seed.initialize();
    settings.set("auth_sessions", {
      ...(settings.get("auth_sessions") as Record<string, unknown>),
      generation: Number.MAX_SAFE_INTEGER
    });
    const auth = new AuthManager(
      client,
      async () => undefined,
      async () => true
    );
    await auth.initialize();

    const key = await auth.reset();
    const { token } = await auth.login(key, "198.51.100.31");

    expect(auth.validate(token)).toBe(true);
    expect(
      (settings.get("auth_sessions") as { generation: number }).generation
    ).toBe(1);
  });

  it("serializes concurrent login failures before calculating backoff", async () => {
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    const client = {
      request: vi.fn().mockResolvedValue(null)
    } as unknown as SessiondClient;
    const delays: number[] = [];
    const auth = new AuthManager(client, async (milliseconds) => {
      delays.push(milliseconds);
    });
    await auth.initialize();

    const attempts = await Promise.allSettled([
      auth.login("wrong-one", "203.0.113.8"),
      auth.login("wrong-two", "203.0.113.8"),
      auth.login("wrong-three", "203.0.113.8")
    ]);

    expect(attempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    expect(delays).toEqual([150, 600]);
    expect(client.request).toHaveBeenCalledTimes(5);
  });

  it("bounds pending login attempts for each remote", async () => {
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    const client = {
      request: vi.fn().mockResolvedValue(null)
    } as unknown as SessiondClient;
    let finishVerification: ((valid: boolean) => void) | undefined;
    const verification = new Promise<boolean>((resolve) => {
      finishVerification = resolve;
    });
    const verify = vi.fn(async () => await verification);
    const auth = new AuthManager(
      client,
      async () => undefined,
      verify
    );
    await auth.initialize();

    const pending = Array.from(
      { length: maxPendingLoginAttemptsPerRemote },
      (_, index) => auth.login(`wrong-${index}`, "203.0.113.9")
    );
    const drained = Promise.allSettled(pending);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());

    await expect(
      auth.login("one-too-many", "203.0.113.9")
    ).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      statusCode: 429
    });

    finishVerification?.(false);
    const results = await drained;
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(verify).toHaveBeenCalledTimes(maxPendingLoginAttemptsPerRemote);
    await expect(auth.login("after-drain", "203.0.113.9")).rejects.toMatchObject(
      { code: "INVALID_ACCESS_KEY", statusCode: 401 }
    );
  });

  it("expires stale login attempts and evicts the oldest remotes at capacity", () => {
    const now = 2 * 60 * 60 * 1000;
    const attempts = new Map<
      string,
      { failures: number; lastFailure: number }
    >([
      ["expired", { failures: 2, lastFailure: 0 }],
      ...Array.from({ length: 2048 }, (_, index) => [
        `remote-${index}`,
        { failures: 1, lastFailure: now - 1000 + index }
      ] as const)
    ]);

    pruneLoginAttempts(attempts, now, "new-remote");

    expect(attempts.has("expired")).toBe(false);
    expect(attempts.has("remote-0")).toBe(false);
    expect(attempts.has("remote-2047")).toBe(true);
    expect(attempts.size).toBe(2047);
  });

  it("rejects an old key whose verification finishes after reset", async () => {
    delete process.env.PI_WEB_ACCESS_KEY;
    const oldHash = await hashAccessKey("old-access-key");
    const settings = new Map<string, unknown>([
      ["access_key_hash", oldHash]
    ]);
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_hash") {
          return settings.get("access_key_hash") ?? null;
        }
        if (method === "auth.get_sessions") {
          return settings.get("auth_sessions") ?? null;
        }
        if (method === "auth.set_hash") {
          settings.set(
            "access_key_hash",
            (params as { hash: unknown }).hash
          );
        }
        if (method === "auth.set_sessions") {
          settings.set(
            "auth_sessions",
            (params as { sessions: unknown }).sessions
          );
        }
        return null;
      }),
      rotateAccessKey: vi.fn(async (input) => {
        settings.set("access_key_hash", input.hash);
        settings.delete("auth_sessions");
        return { updated: true as const };
      })
    } as unknown as SessiondClient;
    let completeVerification: ((valid: boolean) => void) | undefined;
    const verify = vi.fn(
      async () =>
        await new Promise<boolean>((resolve) => {
          completeVerification = resolve;
        })
    );
    const auth = new AuthManager(
      client,
      async () => undefined,
      verify
    );
    await auth.initialize();

    const login = auth.login("old-access-key", "198.51.100.10");
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
    await auth.reset();
    expect(client.rotateAccessKey).toHaveBeenCalledWith(
      expect.objectContaining({
        auditType: "access_key.reset",
        actor: "web"
      })
    );
    completeVerification?.(true);

    await expect(login).rejects.toMatchObject({
      code: "INVALID_ACCESS_KEY",
      statusCode: 401
    });
  });

  it("serializes persisted session snapshots across different remotes", async () => {
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    let persistCount = 0;
    let releaseFirstPersist: (() => void) | undefined;
    let blockPersist = false;
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === "auth.get_sessions") return null;
        if (method === "auth.set_sessions") {
          persistCount += 1;
          if (blockPersist && persistCount === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstPersist = resolve;
            });
          }
        }
        return null;
      })
    } as unknown as SessiondClient;
    const auth = new AuthManager(
      client,
      async () => undefined,
      async () => true
    );
    await auth.initialize();
    persistCount = 0;
    blockPersist = true;

    const first = auth.login("expected-secret", "198.51.100.11");
    const second = auth.login("expected-secret", "198.51.100.12");
    await vi.waitFor(() => expect(persistCount).toBe(1));
    expect(releaseFirstPersist).toBeTypeOf("function");
    releaseFirstPersist?.();
    await Promise.all([first, second]);

    expect(persistCount).toBe(2);
  });

  it("prunes all expired sessions when a later login is persisted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    let persisted: { sessions: unknown[] } | null = null;
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_sessions") return null;
        if (method === "auth.set_sessions") {
          persisted = (params as { sessions: { sessions: unknown[] } }).sessions;
        }
        return null;
      })
    } as unknown as SessiondClient;
    const auth = new AuthManager(
      client,
      async () => undefined,
      async () => true
    );
    await auth.initialize();
    await auth.login("expected-secret", "198.51.100.30");

    vi.setSystemTime(new Date("2026-01-16T00:00:00.000Z"));
    await auth.login("expected-secret", "198.51.100.31");

    expect(persisted).not.toBeNull();
    expect(persisted!.sessions).toHaveLength(1);
  });

  it("keeps the old key and sessions when atomic reset persistence fails", async () => {
    delete process.env.PI_WEB_ACCESS_KEY;
    const oldHash = await hashAccessKey("old-access-key");
    const settings = new Map<string, unknown>([
      ["access_key_hash", oldHash]
    ]);
    const resetFailure = new PiWebError(
      "SESSIOND_UNAVAILABLE",
      "Session daemon is unavailable",
      503
    );
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_hash") {
          return settings.get("access_key_hash") ?? null;
        }
        if (method === "auth.get_sessions") {
          return settings.get("auth_sessions") ?? null;
        }
        if (method === "auth.set_sessions") {
          settings.set(
            "auth_sessions",
            (params as { sessions: unknown }).sessions
          );
        }
        return null;
      }),
      rotateAccessKey: vi.fn().mockRejectedValue(resetFailure)
    } as unknown as SessiondClient;
    const auth = new AuthManager(client);
    await auth.initialize();
    const { token } = await auth.login("old-access-key", "198.51.100.20");

    await expect(auth.reset()).rejects.toBe(resetFailure);

    expect(auth.validate(token)).toBe(true);
    await expect(
      auth.login("old-access-key", "198.51.100.21")
    ).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
    expect(settings.get("access_key_hash")).toEqual(oldHash);
  });

  it("rolls back a login token when session persistence fails", async () => {
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    let failPersistence = false;
    let lastPersisted: unknown;
    const client = {
      request: vi.fn(async (method: string, params?: unknown) => {
        if (method === "auth.get_sessions") return null;
        if (method === "auth.set_sessions") {
          if (failPersistence) {
            throw new PiWebError(
              "SESSIOND_UNAVAILABLE",
              "Session daemon is unavailable",
              503
            );
          }
          lastPersisted = (params as { sessions: unknown }).sessions;
        }
        return null;
      })
    } as unknown as SessiondClient;
    const auth = new AuthManager(
      client,
      async () => undefined,
      async () => true
    );
    await auth.initialize();

    failPersistence = true;
    await expect(
      auth.login("expected-secret", "198.51.100.13")
    ).rejects.toMatchObject({ code: "SESSIOND_UNAVAILABLE" });
    failPersistence = false;
    await auth.login("expected-secret", "198.51.100.14");

    expect(
      (lastPersisted as { sessions: unknown[] }).sessions
    ).toHaveLength(1);
  });
});
