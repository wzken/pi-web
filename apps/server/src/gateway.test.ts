import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGatewaySecurity } from "./gateway.js";

describe("gateway security hooks", () => {
  const validate = vi.fn((token?: string) => token === "valid-token");
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    validate.mockClear();
    app = Fastify();
    await app.register(cookie);
    registerGatewaySecurity(app, { validate });
    app.get("/api/protected", async () => ({ ok: true }));
    app.post("/api/protected", async () => ({ ok: true }));
    app.get("/api/themes", async () => ({ public: true }));
    app.get("/api/ws", async () => ({ connected: true }));
  });

  afterEach(async () => {
    await app.close();
  });

  it("keeps public API exceptions while authenticating protected reads", async () => {
    const publicResponse = await app.inject({
      method: "GET",
      url: "/api/themes"
    });
    const protectedResponse = await app.inject({
      method: "GET",
      url: "/api/protected"
    });

    expect(publicResponse.statusCode).toBe(200);
    expect(protectedResponse.statusCode).toBe(401);
    expect(protectedResponse.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Sign in required" }
    });
  });

  it("requires a matching Origin for writes and browser WebSockets", async () => {
    const headers = {
      cookie: "pi_web_session=valid-token",
      host: "pi.local"
    };
    const rejectedWrite = await app.inject({
      method: "POST",
      url: "/api/protected",
      headers: { ...headers, origin: "https://attacker.example" }
    });
    const rejectedSocket = await app.inject({
      method: "GET",
      url: "/api/ws",
      headers
    });
    const rejectedScheme = await app.inject({
      method: "POST",
      url: "/api/protected",
      headers: { ...headers, origin: "https://pi.local" }
    });
    const acceptedWrite = await app.inject({
      method: "POST",
      url: "/api/protected",
      headers: { ...headers, origin: "http://pi.local" }
    });

    expect(rejectedWrite.statusCode).toBe(403);
    expect(rejectedSocket.statusCode).toBe(403);
    expect(rejectedScheme.statusCode).toBe(403);
    expect(acceptedWrite.statusCode).toBe(200);
  });
});
