import type { RealtimeEvent } from "@pi-web/protocol";
import { useEffect, type Dispatch } from "react";
import {
  isNewerSequence,
  parseSessionSocketMessage,
  resolveAfterSequence
} from "../../../session-realtime";
import { notifySessionCompletion } from "../../../notifications";
import { t } from "../../../i18n";
import type { SessionDetailAction } from "../types";

interface MutableValue<T> {
  current: T;
}

interface UseSessionConnectionOptions {
  sessionId: string;
  connectedSessionId: string | undefined;
  sessionDisplayName: string | undefined;
  dispatch: Dispatch<SessionDetailAction>;
  activeSessionId: MutableValue<string>;
  latestSequence: MutableValue<number>;
  refresh: () => Promise<boolean>;
  scheduleRefresh: () => void;
}

export function useSessionConnection({
  sessionId,
  connectedSessionId,
  sessionDisplayName,
  dispatch,
  activeSessionId,
  latestSequence,
  refresh,
  scheduleRefresh
}: UseSessionConnectionOptions): void {
  useEffect(() => {
    if (!connectedSessionId || connectedSessionId !== sessionId) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retryMs = 500;
    let hasConnected = false;
    const initialSequence = latestSequence.current;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    dispatch({ type: "connection.set", state: "connecting" });

    function applyEvent(event: RealtimeEvent) {
      if (
        activeSessionId.current !== sessionId ||
        event.sessionId !== sessionId ||
        !isNewerSequence(latestSequence.current, event.sequence)
      ) {
        return;
      }
      latestSequence.current = event.sequence;
      sessionStorage.setItem(
        `pi-web-seq:${sessionId}`,
        String(event.sequence)
      );
      dispatch({ type: "realtime.event", event });
      if (
        event.type === "pi.message_end" ||
        event.type === "pi.agent_settled" ||
        event.type === "session.ready" ||
        event.type === "session.worker_exit"
      ) {
        scheduleRefresh();
      }
      if (
        event.type === "pi.agent_settled" ||
        event.type === "session.worker_exit"
      ) {
        notifySessionCompletion({
          sessionId,
          displayName: sessionDisplayName ?? t("Pi 会话"),
          failed: event.type === "session.worker_exit"
        });
      }
    }

    function connect() {
      if (stopped) return;
      socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      socket.addEventListener("open", () => {
        hasConnected = true;
        dispatch({ type: "connection.set", state: "connected" });
        retryMs = 500;
        const afterSequence = resolveAfterSequence(
          sessionStorage.getItem(`pi-web-seq:${sessionId}`),
          Math.max(initialSequence, latestSequence.current)
        );
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            sessionId,
            afterSequence
          })
        );
      });
      socket.addEventListener("message", (message) => {
        const input = parseSessionSocketMessage(message.data);
        if (!input) return;
        if (input.type === "snapshot") {
          const next = input.snapshot;
          if (
            activeSessionId.current === sessionId &&
            next.session.id === sessionId &&
            next.sequence >= latestSequence.current
          ) {
            latestSequence.current = next.sequence;
            sessionStorage.setItem(
              `pi-web-seq:${sessionId}`,
              String(next.sequence)
            );
            dispatch({ type: "snapshot.synced", snapshot: next });
          }
          return;
        }
        if (input.type === "incremental") {
          for (const event of input.events) {
            applyEvent(event);
          }
          return;
        }
        applyEvent(input.event);
      });
      socket.addEventListener("close", () => {
        if (stopped) return;
        dispatch({
          type: "connection.set",
          state: hasConnected ? "reconnecting" : "connecting"
        });
        if (document.visibilityState === "visible") {
          void refresh().catch((error) =>
            dispatch({ type: "error.set", error })
          );
        }
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(5_000, retryMs * 2);
      });
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    activeSessionId,
    connectedSessionId,
    dispatch,
    latestSequence,
    refresh,
    scheduleRefresh,
    sessionDisplayName,
    sessionId
  ]);
}
