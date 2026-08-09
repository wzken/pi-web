import type { FastifyInstance } from "fastify";
import {
  browserSocketMessageSchema,
  type RealtimeEvent,
  type SessionSnapshot
} from "@pi-web/protocol";
import { safeErrorMessage } from "@pi-web/shared";
import type { SessiondClient } from "./sessiond-client.js";

export const sessionProjectionResetCloseCode = 1012;
const maxPendingEventCount = 512;
const maxPendingEventBytes = 2 * 1024 * 1024;

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

interface BrowserSubscription {
  readonly generation: number;
  sequence: number;
  syncing: boolean;
  readonly pendingEvents: RealtimeEvent[];
  pendingEventBytes: number;
}

interface BrowserConnectionSubscriptions {
  nextGeneration: number;
  readonly sessions: Map<string, BrowserSubscription>;
}

export function registerRealtimeRoute(
  app: FastifyInstance,
  client: SessiondClient
): void {
  const subscribers = new Map<BrowserSocket, BrowserConnectionSubscriptions>();

  client.on("event", (event: RealtimeEvent) => {
    const message = JSON.stringify({ type: "event", event });
    for (const [socket, connection] of subscribers) {
      const subscription = connection.sessions.get(event.sessionId);
      if (
        !subscription ||
        event.sequence <= subscription.sequence ||
        socket.readyState !== socket.OPEN
      ) {
        continue;
      }
      if (subscription.syncing) {
        const pendingBytes = Buffer.byteLength(message);
        if (
          subscription.pendingEvents.length >= maxPendingEventCount ||
          subscription.pendingEventBytes + pendingBytes > maxPendingEventBytes
        ) {
          socket.close(
            sessionProjectionResetCloseCode,
            "Session synchronization overflow"
          );
          subscribers.delete(socket);
          continue;
        }
        subscription.pendingEvents.push(event);
        subscription.pendingEventBytes += pendingBytes;
        continue;
      }
      subscription.sequence = event.sequence;
      socket.send(message);
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
    subscribers.set(socket, {
      nextGeneration: 0,
      sessions: new Map()
    });
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
          const connection = subscribers.get(socket);
          if (!connection) return;
          if (input.type === "unsubscribe") {
            connection.sessions.delete(input.sessionId);
            return;
          }
          const generation = ++connection.nextGeneration;
          const subscription: BrowserSubscription = {
            generation,
            sequence: input.afterSequence,
            syncing: true,
            pendingEvents: [],
            pendingEventBytes: 0
          };
          connection.sessions.set(input.sessionId, subscription);
          const isCurrentSubscription = () =>
            subscribers.get(socket) === connection &&
            connection.sessions.get(input.sessionId)?.generation === generation;
          try {
            const sequence = await syncBrowserSubscription(
              socket,
              client,
              input.sessionId,
              input.afterSequence,
              isCurrentSubscription
            );
            if (!isCurrentSubscription()) return;
            subscription.sequence = Math.max(subscription.sequence, sequence);
            while (subscription.pendingEvents.length > 0) {
              const pendingEvents = subscription.pendingEvents.splice(0);
              subscription.pendingEventBytes = 0;
              for (const event of pendingEvents) {
                if (
                  !isCurrentSubscription() ||
                  socket.readyState !== socket.OPEN
                ) {
                  return;
                }
                if (event.sequence <= subscription.sequence) continue;
                subscription.sequence = event.sequence;
                socket.send(JSON.stringify({ type: "event", event }));
              }
            }
            subscription.syncing = false;
          } catch (error) {
            if (!isCurrentSubscription()) return;
            connection.sessions.delete(input.sessionId);
            sendBrowserSocketError(socket, error);
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
  afterSequence: number,
  isCurrentSubscription: () => boolean = () => true
): Promise<number> {
  const sync = await client.request<SessionSyncResult>("sessions.sync", {
    id: sessionId,
    afterSequence
  });
  if (isCurrentSubscription() && socket.readyState === socket.OPEN) {
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
