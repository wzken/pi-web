import type { SessionSnapshot } from "@pi-web/protocol";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef
} from "react";
import { ApiError, api, isAbortError } from "../../../api";
import {
  classifySequence,
  resolveProjectionCursor,
  type SequenceDisposition
} from "../../../session-realtime";
import type {
  SessionDetailAction,
  SessionDetailState
} from "../types";
import {
  applyRealtimeEvent,
  mergeActivityEvent,
  snapshotToolEvents
} from "../utils/session-events";
import { shouldApplyHistoryResponse } from "../utils/session-history";
import {
  prependedTimelineItemCount,
  reconcileTimelineFirstItemIndex
} from "../utils/timeline-index";

export const initialSessionFirstItemIndex = 1_000_000;

function createInitialState(): SessionDetailState {
  return {
    snapshot: null,
    activities: [],
    liveText: "",
    error: null,
    connectionState: "connecting",
    replayBusy: false,
    controlBusy: null,
    firstItemIndex: initialSessionFirstItemIndex,
    clock: Date.now()
  };
}

export function sessionDetailReducer(
  state: SessionDetailState,
  action: SessionDetailAction
): SessionDetailState {
  switch (action.type) {
    case "reset":
      return createInitialState();
    case "projection.replaced":
      return {
        ...state,
        snapshot: action.snapshot,
        activities: snapshotToolEvents(action.snapshot)
          .reduce(mergeActivityEvent, [])
          .slice(-50),
        liveText: action.snapshot.liveText,
        firstItemIndex:
          state.snapshot?.session.id === action.snapshot.session.id
            ? reconcileTimelineFirstItemIndex(
                state.snapshot.messages,
                action.snapshot.messages,
                state.firstItemIndex,
                initialSessionFirstItemIndex
              )
            : initialSessionFirstItemIndex
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
          truncated: action.snapshot.truncated,
          nextCursor: action.snapshot.nextCursor
        },
        firstItemIndex:
          state.firstItemIndex -
          prependedTimelineItemCount(
            state.snapshot.messages,
            action.snapshot.messages
          )
      };
    case "projection.event":
      return applyRealtimeEvent(state, action.event);
    case "session.updated":
      if (state.snapshot?.session.id !== action.session.id) return state;
      return {
        ...state,
        snapshot: { ...state.snapshot, session: action.session }
      };
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
  const projectionEpoch = useRef<string | null>(null);
  const projectionGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const snapshotController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  activeSessionId.current = sessionId;

  const invalidateHistoryRequests = useCallback(() => {
    historyGeneration.current += 1;
    historyController.current?.abort();
    historyController.current = null;
  }, []);

  const refresh = useCallback(async () => {
    const requestedId = sessionId;
    const requestedGeneration = projectionGeneration.current;
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
      projectionGeneration.current !== requestedGeneration ||
      next.session.id !== requestedId ||
      (projectionEpoch.current === next.projectionEpoch &&
        next.sequence < latestSequence.current)
    ) {
      return false;
    }
    projectionEpoch.current = next.projectionEpoch;
    latestSequence.current = next.sequence;
    invalidateHistoryRequests();
    writeSessionCursor(requestedId, {
      projectionEpoch: next.projectionEpoch,
      sequence: next.sequence
    });
    dispatch({
      type: "projection.replaced",
      snapshot: next
    });
    return true;
  }, [invalidateHistoryRequests, sessionId]);

  const requestSnapshotReconciliation = useCallback(() => {
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
    }
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh().catch((error) => dispatch({ type: "error.set", error }));
    }, 120);
  }, [refresh]);

  const acceptSynchronizedSnapshot = useCallback(
    (snapshot: SessionSnapshot): boolean => {
      if (
        activeSessionId.current !== sessionId ||
        snapshot.session.id !== sessionId ||
        (projectionEpoch.current === snapshot.projectionEpoch &&
          snapshot.sequence < latestSequence.current)
      ) {
        return false;
      }
      projectionEpoch.current = snapshot.projectionEpoch;
      latestSequence.current = snapshot.sequence;
      invalidateHistoryRequests();
      writeSessionCursor(sessionId, {
        projectionEpoch: snapshot.projectionEpoch,
        sequence: snapshot.sequence
      });
      dispatch({
        type: "projection.replaced",
        snapshot
      });
      return true;
    },
    [invalidateHistoryRequests, sessionId]
  );

  const acceptRealtimeEvent = useCallback(
    (
      event: import("@pi-web/protocol").RealtimeEvent
    ): SequenceDisposition => {
      if (
        activeSessionId.current !== sessionId ||
        event.sessionId !== sessionId
      ) {
        return "stale";
      }
      if (projectionEpoch.current !== event.projectionEpoch) {
        return "gap";
      }
      const disposition = classifySequence(
        latestSequence.current,
        event.sequence
      );
      if (disposition !== "next") {
        return disposition;
      }
      latestSequence.current = event.sequence;
      writeSessionCursor(sessionId, {
        projectionEpoch: event.projectionEpoch,
        sequence: event.sequence
      });
      dispatch({ type: "projection.event", event });
      return "next";
    },
    [sessionId]
  );

  const getResumeCursor = useCallback(
    () => {
      const fallback = {
        projectionEpoch: projectionEpoch.current ?? "00000000-0000-0000-0000-000000000000",
        sequence: latestSequence.current
      };
      return resolveProjectionCursor(readSessionCursor(sessionId), fallback);
    },
    [sessionId]
  );

  const resetProjection = useCallback(() => {
    projectionGeneration.current += 1;
    invalidateHistoryRequests();
    latestSequence.current = 0;
    projectionEpoch.current = null;
    clearSessionCursor(sessionId);
    snapshotController.current?.abort();
    snapshotController.current = null;
    if (refreshTimer.current !== null) {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    dispatch({ type: "reset" });
  }, [invalidateHistoryRequests, sessionId]);

  const loadEarlier = useCallback(async () => {
    const snapshot = state.snapshot;
    if (!snapshot?.nextCursor) return;
    const requestedId = sessionId;
    const requestedGeneration = historyGeneration.current;
    historyController.current?.abort();
    const controller = new AbortController();
    historyController.current = controller;
    try {
      const older = await api<SessionSnapshot>(
        `/api/sessions/${requestedId}?cursor=${encodeURIComponent(snapshot.nextCursor)}`,
        { signal: controller.signal }
      );
      if (!shouldApplyHistoryResponse({
        requestedSessionId: requestedId,
        activeSessionId: activeSessionId.current,
        responseSessionId: older.session.id,
        requestedGeneration,
        currentGeneration: historyGeneration.current,
        aborted: controller.signal.aborted
      })) {
        return;
      }
      dispatch({
        type: "history.loaded",
        snapshot: older,
        sessionId: requestedId
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "PI_SESSION_CURSOR_STALE" &&
        activeSessionId.current === requestedId &&
        historyGeneration.current === requestedGeneration
      ) {
        try {
          await refresh();
        } catch (refreshError) {
          if (!isAbortError(refreshError)) {
            dispatch({ type: "error.set", error: refreshError });
          }
        }
        return;
      }
      if (
        !isAbortError(error) &&
        activeSessionId.current === requestedId &&
        historyGeneration.current === requestedGeneration
      ) {
        dispatch({ type: "error.set", error });
      }
    } finally {
      if (historyController.current === controller) {
        historyController.current = null;
      }
    }
  }, [refresh, sessionId, state.snapshot]);

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
      invalidateHistoryRequests();
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [invalidateHistoryRequests, refresh]);

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
    requestSnapshotReconciliation,
    acceptSynchronizedSnapshot,
    acceptRealtimeEvent,
    getResumeCursor,
    resetProjection,
    loadEarlier
  };
}

interface SessionSequenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionSequenceKey(sessionId: string): string {
  return `pi-web-seq:${sessionId}`;
}

function browserSessionStorage(): SessionSequenceStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readSessionCursor(
  sessionId: string,
  storage: SessionSequenceStorage | null = browserSessionStorage()
): string | null {
  try {
    return storage?.getItem(sessionSequenceKey(sessionId)) ?? null;
  } catch {
    return null;
  }
}

export function writeSessionCursor(
  sessionId: string,
  cursor: import("@pi-web/protocol").ProjectionCursor,
  storage: SessionSequenceStorage | null = browserSessionStorage()
): void {
  try {
    storage?.setItem(sessionSequenceKey(sessionId), JSON.stringify(cursor));
  } catch {
    // Resume metadata is best-effort; the in-memory sequence remains authoritative.
  }
}

export function clearSessionCursor(
  sessionId: string,
  storage: SessionSequenceStorage | null = browserSessionStorage()
): void {
  try {
    storage?.removeItem(sessionSequenceKey(sessionId));
  } catch {
    // Projection reset remains valid even when browser storage is unavailable.
  }
}
