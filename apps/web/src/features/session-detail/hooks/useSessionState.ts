import type { SessionSnapshot } from "@pi-web/protocol";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef
} from "react";
import { api, isAbortError } from "../../../api";
import type {
  SessionDetailAction,
  SessionDetailState
} from "../types";
import {
  applyRealtimeEvent,
  mergeActivityEvent,
  snapshotToolEvents
} from "../utils/session-events";

function createInitialState(): SessionDetailState {
  return {
    snapshot: null,
    activities: [],
    liveText: "",
    error: null,
    connectionState: "connecting",
    replayBusy: false,
    controlBusy: null,
    clock: Date.now(),
    queuedMessages: { steering: [], followUp: [] }
  };
}

export function sessionDetailReducer(
  state: SessionDetailState,
  action: SessionDetailAction
): SessionDetailState {
  switch (action.type) {
    case "reset":
      return createInitialState();
    case "snapshot.refreshed":
      return {
        ...state,
        snapshot: action.snapshot,
        activities: snapshotToolEvents(action.snapshot)
          .reduce(mergeActivityEvent, state.activities)
          .slice(-50),
        liveText: "",
        queuedMessages: action.snapshot.queuedMessages
      };
    case "snapshot.synced":
      return {
        ...state,
        snapshot: action.snapshot,
        activities: snapshotToolEvents(action.snapshot)
          .reduce(mergeActivityEvent, [])
          .slice(-50),
        liveText: "",
        queuedMessages: action.snapshot.queuedMessages
      };
    case "history.loaded":
      if (state.snapshot?.session.id !== action.sessionId) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          messages: [
            ...action.snapshot.messages,
            ...state.snapshot.messages
          ],
          entries: [...action.snapshot.entries, ...state.snapshot.entries],
          truncated: action.snapshot.truncated,
          nextCursor: action.snapshot.nextCursor
        }
      };
    case "realtime.event":
      return applyRealtimeEvent(state, action.event);
    case "session.updated":
      if (state.snapshot?.session.id !== action.session.id) return state;
      return {
        ...state,
        snapshot: { ...state.snapshot, session: action.session }
      };
    case "session.status":
      if (!state.snapshot) return state;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          session: { ...state.snapshot.session, status: action.status }
        }
      };
    case "liveText.clear":
      return { ...state, liveText: "" };
    case "error.set":
      return { ...state, error: action.error };
    case "connection.set":
      return { ...state, connectionState: action.state };
    case "replayBusy.set":
      return { ...state, replayBusy: action.busy };
    case "controlBusy.set":
      return { ...state, controlBusy: action.action };
    case "clock.tick":
      return { ...state, clock: action.now };
    default:
      return state;
  }
}

export function useSessionState(sessionId: string) {
  const [state, dispatch] = useReducer(
    sessionDetailReducer,
    undefined,
    createInitialState
  );
  const activeSessionId = useRef(sessionId);
  const latestSequence = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const snapshotController = useRef<AbortController | null>(null);
  activeSessionId.current = sessionId;

  const refresh = useCallback(async () => {
    const requestedId = sessionId;
    snapshotController.current?.abort();
    const controller = new AbortController();
    snapshotController.current = controller;
    let next: SessionSnapshot;
    try {
      next = await api<SessionSnapshot>(`/api/sessions/${requestedId}`, {
        signal: controller.signal
      });
    } catch (reason) {
      if (isAbortError(reason)) return false;
      if (activeSessionId.current !== requestedId) return false;
      throw reason;
    } finally {
      if (snapshotController.current === controller) {
        snapshotController.current = null;
      }
    }
    if (
      activeSessionId.current !== requestedId ||
      next.session.id !== requestedId ||
      next.sequence < latestSequence.current
    ) {
      return false;
    }
    latestSequence.current = next.sequence;
    sessionStorage.setItem(`pi-web-seq:${requestedId}`, String(next.sequence));
    dispatch({ type: "snapshot.refreshed", snapshot: next });
    return true;
  }, [sessionId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh().catch((error) => dispatch({ type: "error.set", error }));
    }, 120);
  }, [refresh]);

  const loadEarlier = useCallback(async () => {
    const snapshot = state.snapshot;
    if (!snapshot?.nextCursor) return;
    try {
      const older = await api<SessionSnapshot>(
        `/api/sessions/${sessionId}?cursor=${encodeURIComponent(snapshot.nextCursor)}`
      );
      dispatch({
        type: "history.loaded",
        snapshot: older,
        sessionId
      });
    } catch (error) {
      if (activeSessionId.current === sessionId) {
        dispatch({ type: "error.set", error });
      }
    }
  }, [sessionId, state.snapshot]);

  useEffect(() => {
    latestSequence.current = 0;
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    dispatch({ type: "reset" });
    void refresh().catch((error) => dispatch({ type: "error.set", error }));
    return () => {
      snapshotController.current?.abort();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [refresh]);

  const sessionStatus = state.snapshot?.session.status;
  useEffect(() => {
    if (
      !sessionStatus ||
      ["failed", "interrupted", "closed"].includes(sessionStatus)
    ) {
      return;
    }
    const timer = window.setInterval(
      () => dispatch({ type: "clock.tick", now: Date.now() }),
      1_000
    );
    return () => window.clearInterval(timer);
  }, [sessionStatus]);

  return {
    state,
    dispatch,
    refresh,
    scheduleRefresh,
    loadEarlier,
    activeSessionId,
    latestSequence
  };
}
