import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGatewayErrorHandler } from "./gateway.js";
import { registerSessionRoutes } from "./session-routes.js";
import type { SessiondClient } from "@pi-web/ipc";

describe("session HTTP routes", () => {
  const request = vi.fn();
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    request.mockReset();
    app = Fastify();
    registerGatewayErrorHandler(app);
    registerSessionRoutes(app, { request } as unknown as SessiondClient);
  });

  afterEach(async () => {
    await app.close();
  });

  it("forwards validated session list pagination to Sessiond", async () => {
    request.mockResolvedValue({ sessions: [], nextCursor: null });

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions?limit=25&cursor=opaque-cursor"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessions: [], nextCursor: null });
    expect(request).toHaveBeenCalledWith("sessions.list", {
      limit: 25,
      cursor: "opaque-cursor"
    });
  });

  it("rejects an invalid session list limit before IPC", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions?limit=101"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps session creation as a validated 201 RPC pass-through", async () => {
    request.mockResolvedValue({ id: "session-1" });
    const mutationId = "4b650b13-d818-4931-b193-c2da51c2b27b";

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: {
        mutationId,
        cwd: "/workspace",
        displayName: "Refactor",
        images: []
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: "session-1" });
    expect(request).toHaveBeenCalledWith("sessions.create", {
      mutationId,
      cwd: "/workspace",
      displayName: "Refactor",
      images: []
    }, 120_000);
  });

  it("forwards prompt and resume mutation IDs to Sessiond", async () => {
    request.mockResolvedValue({ accepted: true });
    const id = "ad30361b-6d63-48ce-8347-879913471852";
    const promptMutationId = "4b650b13-d818-4931-b193-c2da51c2b27b";
    const resumeMutationId = "eeacdf65-ec8c-46ce-8b10-709d292e4b7d";

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${id}/messages`,
          payload: {
            mutationId: promptMutationId,
            message: "Continue",
            images: [],
            behavior: "prompt"
          }
        })
      ).statusCode
    ).toBe(202);
    await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/resume`,
      payload: {
        mutationId: resumeMutationId,
        prompt: "Retry",
        images: []
      }
    });

    expect(request).toHaveBeenNthCalledWith(1, "sessions.prompt", {
      id,
      mutationId: promptMutationId,
      message: "Continue",
      images: [],
      behavior: "prompt"
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.resume", {
      id,
      mutationId: resumeMutationId,
      prompt: "Retry",
      images: []
    });
  });

  it("preserves the snapshot cursor when forwarding session reads", async () => {
    request.mockResolvedValue({ sequence: 8 });
    const id = "ad30361b-6d63-48ce-8347-879913471852";

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${id}?cursor=opaque-cursor`
    });

    expect(response.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith("sessions.snapshot", {
      id,
      cursor: "opaque-cursor"
    });
  });

  it("forwards persistent pin and delete actions through Sessiond", async () => {
    request.mockResolvedValue({ pinned: true });
    const id = "ad30361b-6d63-48ce-8347-879913471852";

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/sessions/${id}/pin`,
          payload: { pinned: true }
        })
      ).statusCode
    ).toBe(200);
    request.mockResolvedValue({ deleted: true });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/sessions/${id}`
        })
      ).statusCode
    ).toBe(200);

    expect(request).toHaveBeenNthCalledWith(1, "sessions.pin", {
      id,
      pinned: true
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.delete", { id });
  });

  it("creates a session branch through the long-running Sessiond request", async () => {
    const id = "ad30361b-6d63-48ce-8347-879913471852";
    request.mockResolvedValue({ id: "forked-session" });

    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${id}/fork`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: "forked-session" });
    expect(request).toHaveBeenCalledWith(
      "sessions.fork",
      { id },
      120_000
    );
  });

  it("keeps folder metadata behind the Sessiond boundary", async () => {
    request.mockResolvedValue({ folders: [], assignments: {} });
    const sessionId = "ad30361b-6d63-48ce-8347-879913471852";

    const response = await app.inject({
      method: "PUT",
      url: `/api/session-folders/assign/${sessionId}`,
      payload: { folderId: null }
    });

    expect(response.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith("session_folders.assign", {
      sessionId,
      folderId: null
    });
  });
});
