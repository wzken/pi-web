import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { RealtimeEvent, SessionSnapshot } from "@pi-web/protocol";
import {
  registerRealtimeRoute,
  sessionProjectionResetCloseCode,
  syncBrowserSubscription
} from "./realtime.js";
import type { SessiondClient } from "@pi-web/ipc";

const epoch = "11111111-1111-4111-8111-111111111111";

describe("browser session synchronization", () => {
  it("forwards an authoritative snapshot when incremental replay is unavailable", async () => {
    const snapshot = {
      session: {
        id: "session-1",
        status: "interrupted"
      },
      projectionEpoch: epoch,
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

    const cursor = await syncBrowserSubscription(
      socket,
      client,
      "session-1",
      epoch,
      14
    );

    expect(client.request).toHaveBeenCalledWith("sessions.sync", {
      id: "session-1",
      projectionEpoch: epoch,
      afterSequence: 14
    });
    expect(cursor).toEqual({ projectionEpoch: epoch, sequence: 14 });
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
        projectionEpoch: epoch,
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
      await syncBrowserSubscription(socket, client, "session-1", epoch, 7)
    ).toEqual({ projectionEpoch: epoch, sequence: 9 });
    expect(client.request).toHaveBeenCalledWith("sessions.sync", {
      id: "session-1",
      projectionEpoch: epoch,
      afterSequence: 7
    });
  });

  it("buffers live events until the initial synchronization is sent", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    type IncrementalSync = {
      mode: "incremental";
      projectionEpoch: string;
      events: RealtimeEvent[];
      sequence: number;
    };
    let resolveSync!: (value: IncrementalSync) => void;
    const sync = new Promise<IncrementalSync>((resolve) => {
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
      JSON.stringify({
        type: "subscribe",
        sessionId,
        projectionEpoch: epoch,
        afterSequence: 4
      })
    );
    const event: RealtimeEvent = {
      sessionId,
      projectionEpoch: epoch,
      sequence: 6,
      type: "message",
      timestamp: "2026-08-03T00:00:00.000Z",
      payload: { text: "arrived during sync" }
    };
    client.emit("event", event);

    expect(messages).toEqual([]);

    resolveSync({
      mode: "incremental",
      projectionEpoch: epoch,
      events: [],
      sequence: 5
    });
    await vi.waitFor(() => expect(messages).toHaveLength(2));

    expect(messages.map((message) => message.type)).toEqual(["sync", "event"]);
    expect(messages[1]).toMatchObject({ event: { sequence: 6 } });
  });

  it("resets sequence authority when synchronization returns a new epoch", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const nextEpoch = "22222222-2222-4222-8222-222222222222";
    let resolveSync!: (value: {
      mode: "snapshot";
      snapshot: SessionSnapshot;
    }) => void;
    const sync = new Promise<{
      mode: "snapshot";
      snapshot: SessionSnapshot;
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
      JSON.stringify({
        type: "subscribe",
        sessionId,
        projectionEpoch: epoch,
        afterSequence: 50
      })
    );
    client.emit("event", {
      sessionId,
      projectionEpoch: nextEpoch,
      sequence: 4,
      type: "session.status",
      timestamp: "2026-08-12T00:00:00.000Z",
      payload: { status: "waiting" }
    } satisfies RealtimeEvent);

    resolveSync({
      mode: "snapshot",
      snapshot: {
        session: { id: sessionId, status: "running" },
        projectionEpoch: nextEpoch,
        sequence: 3
      } as SessionSnapshot
    });
    await vi.waitFor(() => expect(messages).toHaveLength(2));

    expect(messages[0]).toMatchObject({
      type: "sync",
      mode: "snapshot",
      snapshot: { projectionEpoch: nextEpoch, sequence: 3 }
    });
    expect(messages[1]).toMatchObject({
      type: "event",
      event: { projectionEpoch: nextEpoch, sequence: 4 }
    });
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("resets a connection when live events overflow during synchronization", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    type IncrementalSync = {
      mode: "incremental";
      projectionEpoch: string;
      events: RealtimeEvent[];
      sequence: number;
    };
    let resolveSync!: (value: IncrementalSync) => void;
    const sync = new Promise<IncrementalSync>((resolve) => {
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
      JSON.stringify({
        type: "subscribe",
        sessionId,
        projectionEpoch: epoch,
        afterSequence: 0
      })
    );
    for (let sequence = 1; sequence <= 513; sequence += 1) {
      client.emit("event", {
        sessionId,
        projectionEpoch: epoch,
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
    resolveSync({
      mode: "incremental",
      projectionEpoch: epoch,
      events: [],
      sequence: 0
    });
  });

  it("ignores an obsolete sync after unsubscribe and resubscribe", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    type IncrementalSync = {
      mode: "incremental";
      projectionEpoch: string;
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
    sendMessage({
      type: "subscribe",
      sessionId,
      projectionEpoch: epoch,
      afterSequence: 2
    });
    sendMessage({ type: "unsubscribe", sessionId });
    sendMessage({
      type: "subscribe",
      sessionId,
      projectionEpoch: epoch,
      afterSequence: 7
    });

    resolvers[0]?.({
      mode: "incremental",
      projectionEpoch: epoch,
      events: [],
      sequence: 4
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages).toEqual([]);

    resolvers[1]?.({
      mode: "incremental",
      projectionEpoch: epoch,
      events: [],
      sequence: 8
    });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toMatchObject({
      type: "sync",
      sessionId,
      sequence: 8
    });
  });

  it("broadcasts global notifications without a session subscription", () => {
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
    const messages: Array<Record<string, unknown>> = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((message: string) => {
        messages.push(JSON.parse(message) as Record<string, unknown>);
      }),
      close: vi.fn(),
      on: vi.fn()
    };

    registerRealtimeRoute(
      app as unknown as FastifyInstance,
      client as unknown as SessiondClient
    );
    websocketHandler?.(socket);
    client.emit("notification", {
      id: "notification-1",
      kind: "extension_interaction",
      severity: "warning",
      title: "Pi needs your decision",
      body: "Session name",
      href: "/sessions/session-1",
      sessionId: "session-1",
      jobId: null,
      runId: null,
      requiresAction: true,
      readAt: null,
      resolvedAt: null,
      dismissedAt: null,
      createdAt: "2026-08-12T05:00:00.000Z",
      updatedAt: "2026-08-12T05:00:00.000Z"
    });

    expect(messages).toEqual([
      {
        type: "notification",
        notification: expect.objectContaining({ id: "notification-1" })
      }
    ]);
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
