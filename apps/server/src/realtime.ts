import type { FastifyInstance } from "fastify";
import {
  browserSocketMessageSchema,
  type RealtimeEvent,
  type SessionSnapshot
} from "@pi-web/protocol";
import { safeErrorMessage } from "@pi-web/shared";
import type { SessiondClient } from "./sessiond-client.js";

export const sessionProjectionResetCloseCode = 1012;

interface BrowserSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(value: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (value: unknown) => void): void;
  on(event: "close" | "error", listener: () => void): void;
}

type SessionSyncResult =
  | {
      mode: "incremental";
      events: RealtimeEvent[];
      sequence: number;
    }
  | {
      mode: "snapshot";
      snapshot: SessionSnapshot;
    };

export function registerRealtimeRoute(
  app: FastifyInstance,
  client: SessiondClient
): void {
  const subscribers = new Map<BrowserSocket, Map<string, number>>();

  client.on("event", (event: RealtimeEvent) => {
    const message = JSON.stringify({ type: "event", event });
    for (const [socket, sessions] of subscribers) {
      const afterSequence = sessions.get(event.sessionId);
      if (
        afterSequence !== undefined &&
        event.sequence > afterSequence &&
        socket.readyState === socket.OPEN
      ) {
        sessions.set(event.sessionId, event.sequence);
        socket.send(message);
      }
    }
  });

  const resetSubscribers = (reason: string) => {
    for (const socket of subscribers.keys()) {
      if (socket.readyState === socket.OPEN) {
        socket.close(
          sessionProjectionResetCloseCode,
          reason
        );
      }
    }
    subscribers.clear();
  };
  client.on("disconnect", () =>
    resetSubscribers("Session daemon disconnected")
  );
  client.on("connect", () => resetSubscribers("Session daemon restarted"));

  app.get("/api/ws", { websocket: true }, (rawSocket) => {
    const socket = rawSocket as unknown as BrowserSocket;
    subscribers.set(socket, new Map());
    socket.on("message", (raw: unknown) => {
      void (async () => {
        try {
          const input = browserSocketMessageSchema.parse(
            JSON.parse(String(raw))
          );
          if (input.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
            return;
          }
          const sessions = subscribers.get(socket);
          if (!sessions) return;
          if (input.type === "unsubscribe") {
            sessions.delete(input.sessionId);
            return;
          }
          sessions.set(input.sessionId, input.afterSequence);
          const sequence = await syncBrowserSubscription(
            socket,
            client,
            input.sessionId,
            input.afterSequence
          );
          if (sessions.has(input.sessionId)) {
            sessions.set(
              input.sessionId,
              Math.max(sessions.get(input.sessionId) ?? 0, sequence)
            );
          }
        } catch (error) {
          sendBrowserSocketError(socket, error);
        }
      })();
    });
    socket.on("close", () => subscribers.delete(socket));
    socket.on("error", () => subscribers.delete(socket));
  });
}

export async function syncBrowserSubscription(
  socket: Pick<BrowserSocket, "readyState" | "OPEN" | "send">,
  client: Pick<SessiondClient, "request">,
  sessionId: string,
  afterSequence: number
): Promise<number> {
  const sync = await client.request<SessionSyncResult>("sessions.sync", {
    id: sessionId,
    afterSequence
  });
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "sync", sessionId, ...sync }));
  }
  return sync.mode === "snapshot"
    ? sync.snapshot.sequence
    : sync.sequence;
}

function sendBrowserSocketError(
  socket: Pick<BrowserSocket, "readyState" | "OPEN" | "send">,
  error: unknown
): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "error",
        message: safeErrorMessage(error)
      })
    );
  }
}
