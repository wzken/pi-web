import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent, SessionSnapshot } from "@pi-web/protocol";
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

  it("buffers live events until the initial synchronization is sent", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    let resolveSync!: (value: {
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }) => void;
    const sync = new Promise<{
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }>((resolve) => {
      resolveSync = resolve;
    });
    const client = Object.assign(new EventEmitter(), {
      request: vi.fn().mockReturnValue(sync)
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
    const messages: Array<Record<string, unknown>> = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((message: string) => {
        messages.push(JSON.parse(message) as Record<string, unknown>);
      }),
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
    listeners.get("message")?.(
      JSON.stringify({ type: "subscribe", sessionId, afterSequence: 4 })
    );
    const event: RealtimeEvent = {
      sessionId,
      sequence: 6,
      type: "message",
      timestamp: "2026-08-03T00:00:00.000Z",
      payload: { text: "arrived during sync" }
    };
    client.emit("event", event);

    expect(messages).toEqual([]);

    resolveSync({ mode: "incremental", events: [], sequence: 5 });
    await vi.waitFor(() => expect(messages).toHaveLength(2));

    expect(messages.map((message) => message.type)).toEqual(["sync", "event"]);
    expect(messages[1]).toMatchObject({ event: { sequence: 6 } });
  });

  it("resets a connection when live events overflow during synchronization", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    let resolveSync!: (value: {
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }) => void;
    const sync = new Promise<{
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }>((resolve) => {
      resolveSync = resolve;
    });
    const client = Object.assign(new EventEmitter(), {
      request: vi.fn().mockReturnValue(sync)
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
    listeners.get("message")?.(
      JSON.stringify({ type: "subscribe", sessionId, afterSequence: 0 })
    );
    for (let sequence = 1; sequence <= 513; sequence += 1) {
      client.emit("event", {
        sessionId,
        sequence,
        type: "message",
        timestamp: "2026-08-03T00:00:00.000Z",
        payload: { text: "pending" }
      } satisfies RealtimeEvent);
    }

    expect(socket.close).toHaveBeenCalledWith(
      sessionProjectionResetCloseCode,
      "Session synchronization overflow"
    );
    resolveSync({ mode: "incremental", events: [], sequence: 0 });
  });

  it("ignores an obsolete sync after unsubscribe and resubscribe", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    type IncrementalSync = {
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    };
    const resolvers: Array<(value: IncrementalSync) => void> = [];
    const client = Object.assign(new EventEmitter(), {
      request: vi.fn().mockImplementation(
        () =>
          new Promise<IncrementalSync>((resolve) => {
            resolvers.push(resolve);
          })
      )
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
    const messages: Array<Record<string, unknown>> = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((message: string) => {
        messages.push(JSON.parse(message) as Record<string, unknown>);
      }),
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
    const sendMessage = (message: Record<string, unknown>) =>
      listeners.get("message")?.(JSON.stringify(message));
    sendMessage({ type: "subscribe", sessionId, afterSequence: 2 });
    sendMessage({ type: "unsubscribe", sessionId });
    sendMessage({ type: "subscribe", sessionId, afterSequence: 7 });

    resolvers[0]?.({ mode: "incremental", events: [], sequence: 4 });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual([]);

    resolvers[1]?.({ mode: "incremental", events: [], sequence: 8 });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toMatchObject({
      type: "sync",
      sessionId,
      sequence: 8
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
