import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfig } from "@pi-web/config";
import { AuthManager, shouldUseSecureCookie } from "./auth.js";
import type { SessiondClient } from "./sessiond-client.js";

const config = {
  cookieSecure: "auto"
} as PiWebConfig;

describe("server authentication policy", () => {
  const savedKey = process.env.PI_WEB_ACCESS_KEY;

  afterEach(() => {
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
    const auth = new AuthManager(client, config);
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

    const first = new AuthManager(client, config);
    await first.initialize();
    const { token } = await first.login("persistent-secret", "127.0.0.1");
    expect(first.validate(token)).toBe(true);

    const restarted = new AuthManager(client, config);
    await restarted.initialize();
    expect(restarted.validate(token)).toBe(true);
    expect(JSON.stringify(settings.get("auth_sessions"))).not.toContain(token);

    await restarted.logout(token);
    const afterLogoutRestart = new AuthManager(client, config);
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
    const first = new AuthManager(client, config);
    await first.initialize();
    const { token } = await first.login("first-secret", "127.0.0.1");

    process.env.PI_WEB_ACCESS_KEY = "second-secret";
    const restarted = new AuthManager(client, config);
    await restarted.initialize();
    expect(restarted.validate(token)).toBe(false);
  });

  it("serializes concurrent login failures before calculating backoff", async () => {
    process.env.PI_WEB_ACCESS_KEY = "expected-secret";
    const client = {
      request: vi.fn().mockResolvedValue(null)
    } as unknown as SessiondClient;
    const delays: number[] = [];
    const auth = new AuthManager(client, config, async (milliseconds) => {
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
});
