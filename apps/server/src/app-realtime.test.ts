import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@pi-web/protocol";
import {
  registerRealtimeRoute,
  sessionProjectionResetCloseCode,
  syncBrowserSubscription
} from "./realtime.js";
import type { SessiondClient } from "./sessiond-client.js";

describe("browser session synchronization", () => {
  it("forwards an authoritative snapshot when incremental replay is unavailable", async () => {
    const snapshot = {
      session: {
        id: "session-1",
        status: "interrupted"
      },
      sequence: 14
    } as SessionSnapshot;
    const client = {
      request: vi.fn().mockResolvedValue({ mode: "snapshot", snapshot })
    };
    const messages: string[] = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: (message: string) => messages.push(message)
    };

    const sequence = await syncBrowserSubscription(socket, client, "session-1", 14);

    expect(client.request).toHaveBeenCalledWith("sessions.sync", {
      id: "session-1",
      afterSequence: 14
    });
    expect(sequence).toBe(14);
    expect(JSON.parse(messages[0]!)).toMatchObject({
      type: "sync",
      sessionId: "session-1",
      mode: "snapshot",
      snapshot: {
        sequence: 14,
        session: { status: "interrupted" }
      }
    });
  });

  it("uses incremental synchronization for a normal subscription", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        mode: "incremental",
        events: [],
        sequence: 9
      })
    };
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn()
    };

    expect(
      await syncBrowserSubscription(socket, client, "session-1", 7)
    ).toBe(9);
    expect(client.request).toHaveBeenCalledWith("sessions.sync", {
      id: "session-1",
      afterSequence: 7
    });
  });

  it("closes browser sockets immediately when the daemon disconnects", () => {
    const client = Object.assign(new EventEmitter(), {
      request: vi.fn()
    });
    let websocketHandler: ((socket: unknown) => void) | undefined;
    const app = {
      get: vi.fn(
        (
          _path: string,
          _options: unknown,
          handler: (socket: unknown) => void
        ) => {
          websocketHandler = handler;
        }
      )
    };
    const listeners = new Map<string, (value?: unknown) => void>();
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, listener: (value?: unknown) => void) => {
        listeners.set(event, listener);
      })
    };

    registerRealtimeRoute(
      app as unknown as FastifyInstance,
      client as unknown as SessiondClient
    );
    websocketHandler?.(socket);

    client.emit("disconnect");

    expect(socket.close).toHaveBeenCalledWith(
      sessionProjectionResetCloseCode,
      "Session daemon disconnected"
    );
    expect(client.request).not.toHaveBeenCalled();

    client.emit("connect");
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
