import type {
  RealtimeEvent,
  SessionSnapshot
} from "@pi-web/protocol";
import { useEffect } from "react";
import {
  createSessionHeartbeat,
  mergeSynchronizedEvents,
  parseSessionSocketMessage,
  sessionProjectionResetCloseCode,
  type SessionHeartbeat,
  type SequenceDisposition
} from "../../../session-realtime";
import type { ConnectionState } from "../types";

interface UseSessionConnectionOptions {
  sessionId: string;
  enabled: boolean;
  getResumeCursor: () => import("@pi-web/protocol").ProjectionCursor;
  onSnapshot: (snapshot: SessionSnapshot) => boolean;
  onEvent: (event: RealtimeEvent) => SequenceDisposition;
  onError: (error: unknown) => void;
  onSynchronized: () => void;
  onConnectionStateChange: (state: ConnectionState) => void;
  onProjectionReset: () => void;
  onDisconnect: (projectionReset: boolean) => void;
}

const maxPreSynchronizationEvents = 512;
const maxPreSynchronizationCharacters = 2 * 1024 * 1024;

export function useSessionConnection({
  sessionId,
  enabled,
  getResumeCursor,
  onSnapshot,
  onEvent,
  onError,
  onSynchronized,
  onConnectionStateChange,
  onProjectionReset,
  onDisconnect
}: UseSessionConnectionOptions): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let heartbeat: SessionHeartbeat | null = null;
    let reconnectTimer: number | null = null;
    let retryMs = 500;
    let hasConnected = false;
    let synchronized = false;
    let bufferedEvents: RealtimeEvent[] = [];
    let bufferedEventCharacters = 0;
    let projectionResetHandled = false;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    onConnectionStateChange("connecting");

    function resetConnectionProjection() {
      if (projectionResetHandled || stopped) return;
      projectionResetHandled = true;
      onProjectionReset();
      onConnectionStateChange(
        hasConnected ? "reconnecting" : "connecting"
      );
      onDisconnect(true);
      socket?.close();
    }

    function deliverEvents(events: RealtimeEvent[]): boolean {
      for (const event of events) {
        if (onEvent(event) === "gap") {
          resetConnectionProjection();
          return false;
        }
      }
      return true;
    }

    function completeSynchronization(events: RealtimeEvent[]): void {
      synchronized = true;
      const pending = bufferedEvents;
      bufferedEvents = [];
      bufferedEventCharacters = 0;
      if (!deliverEvents(mergeSynchronizedEvents(events, pending))) return;
      hasConnected = true;
      onSynchronized();
      onConnectionStateChange("connected");
    }

    function connect() {
      if (stopped) return;
      heartbeat?.stop();
      heartbeat = null;
      synchronized = false;
      bufferedEvents = [];
      bufferedEventCharacters = 0;
      projectionResetHandled = false;
      const nextSocket = new WebSocket(
        `${protocol}//${window.location.host}/api/ws`
      );
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        retryMs = 500;
        const cursor = getResumeCursor();
        nextSocket.send(
          JSON.stringify({
            type: "subscribe",
            sessionId,
            projectionEpoch: cursor.projectionEpoch,
            afterSequence: cursor.sequence
          })
        );
        heartbeat = createSessionHeartbeat({
          sendPing: () => {
            if (nextSocket.readyState === WebSocket.OPEN) {
              nextSocket.send(JSON.stringify({ type: "ping" }));
            }
          },
          onTimeout: () => {
            if (nextSocket.readyState === WebSocket.OPEN) {
              nextSocket.close();
            }
          }
        });
        heartbeat.start();
      });
      nextSocket.addEventListener("message", (message) => {
        const input = parseSessionSocketMessage(message.data);
        if (!input) return;
        if (input.type === "pong") {
          heartbeat?.acknowledge();
          return;
        }
        if (input.type === "error") {
          onError(new Error(input.message));
          nextSocket.close();
          return;
        }
        if (input.type === "snapshot") {
          if (!onSnapshot(input.snapshot)) {
            resetConnectionProjection();
            return;
          }
          completeSynchronization([]);
          return;
        }
        if (input.type === "incremental") {
          completeSynchronization(input.events);
          return;
        }
        if (!synchronized) {
          const eventCharacters = serializedCharacters(input.event);
          if (
            bufferedEvents.length >= maxPreSynchronizationEvents ||
            eventCharacters >
              maxPreSynchronizationCharacters - bufferedEventCharacters
          ) {
            resetConnectionProjection();
            return;
          }
          bufferedEvents.push(input.event);
          bufferedEventCharacters += eventCharacters;
          return;
        }
        deliverEvents([input.event]);
      });
      nextSocket.addEventListener("close", (event) => {
        heartbeat?.stop();
        heartbeat = null;
        if (stopped) return;
        if (projectionResetHandled) return;
        if (event.code === sessionProjectionResetCloseCode) {
          resetConnectionProjection();
          return;
        }
        onConnectionStateChange(
          hasConnected ? "reconnecting" : "connecting"
        );
        onDisconnect(false);
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(5_000, retryMs * 2);
      });
    }

    connect();
    return () => {
      stopped = true;
      heartbeat?.stop();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    enabled,
    getResumeCursor,
    onConnectionStateChange,
    onDisconnect,
    onEvent,
    onError,
    onProjectionReset,
    onSnapshot,
    onSynchronized,
    sessionId
  ]);
}

function serializedCharacters(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
