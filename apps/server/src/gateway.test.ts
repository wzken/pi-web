import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerGatewaySecurity,
  registerWebAssets
} from "./gateway.js";

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

describe("web assets", () => {
  it("serves files added after startup", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "pi-web-assets-"));
    const previousWebRoot = process.env.PI_WEB_WEB_ROOT;
    const app = Fastify();
    process.env.PI_WEB_WEB_ROOT = webRoot;

    try {
      await writeFile(join(webRoot, "index.html"), "<main>Pi Web</main>");
      await registerWebAssets(app);
      await writeFile(join(webRoot, "late.js"), "export const ready = true;");

      const response = await app.inject({ url: "/late.js" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/javascript");
      expect(response.body).toBe("export const ready = true;");
    } finally {
      await app.close();
      if (previousWebRoot === undefined) delete process.env.PI_WEB_WEB_ROOT;
      else process.env.PI_WEB_WEB_ROOT = previousWebRoot;
      await rm(webRoot, { recursive: true, force: true });
    }
  });
});
