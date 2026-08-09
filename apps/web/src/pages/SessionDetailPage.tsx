import type { RealtimeEvent } from "@pi-web/protocol";
import { useCallback, useEffect, useRef } from "react";
import { Button, ButtonLink, ErrorBanner, Loading } from "../components";
import { SessionDetailView } from "../features/session-detail/components/SessionDetailView";
import { useSessionConnection } from "../features/session-detail/hooks/useSessionConnection";
import { useSessionControls } from "../features/session-detail/hooks/useSessionControls";
import { useSessionState } from "../features/session-detail/hooks/useSessionState";
import type { ConnectionState } from "../features/session-detail/types";
import { shouldReconcileSnapshot } from "../features/session-detail/utils/session-events";
import { useParams } from "../router";
import {
  clearSessionUnread,
  notifySessionSettled
} from "../notifications";
import { t } from "../i18n";
import {
  projectionRecoveryDelay,
  shouldRefreshProjectionAfterDisconnect
} from "../session-realtime";
import { ui } from "../ui";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const {
    state,
    dispatch,
    refresh,
    requestSnapshotReconciliation,
    acceptSynchronizedSnapshot,
    acceptRealtimeEvent,
    getResumeSequence,
    resetProjection,
    loadEarlier
  } = useSessionState(id);
  const currentSnapshot =
    state.snapshot?.session.id === id ? state.snapshot : null;
  const displayName = useRef<string | undefined>(undefined);
  const projectionRecoveryGeneration = useRef(0);
  const projectionRecoveryTimer = useRef<number | null>(null);
  displayName.current = currentSnapshot?.session.displayName;

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      const disposition = acceptRealtimeEvent(event);
      if (disposition !== "next") return disposition;
      if (shouldReconcileSnapshot(event)) {
        requestSnapshotReconciliation();
      }
      if (
        event.type === "pi.agent_settled" ||
        event.type === "session.worker_exit"
      ) {
        notifySessionSettled({
          sessionId: id,
          displayName: displayName.current ?? t("Pi 会话"),
          failed: event.type === "session.worker_exit"
        });
      }
      return disposition;
    },
    [acceptRealtimeEvent, id, requestSnapshotReconciliation]
  );

  const recoverProjection = useCallback(
    function recoverProjectionForGeneration(
      generation: number,
      failedAttempts: number
    ) {
      function retry() {
        if (projectionRecoveryGeneration.current !== generation) return;
        const delay = projectionRecoveryDelay(failedAttempts);
        if (delay === null) return;
        projectionRecoveryTimer.current = window.setTimeout(() => {
          projectionRecoveryTimer.current = null;
          recoverProjectionForGeneration(generation, failedAttempts + 1);
        }, delay);
      }

      void refresh()
        .then((accepted) => {
          if (projectionRecoveryGeneration.current !== generation) return;
          if (accepted) {
            dispatch({ type: "error.set", error: null });
            return;
          }
          retry();
        })
        .catch((error) => {
          if (projectionRecoveryGeneration.current !== generation) return;
          dispatch({ type: "error.set", error });
          retry();
        });
    },
    [dispatch, refresh]
  );

  const armProjectionRecovery = useCallback(() => {
    if (projectionRecoveryTimer.current !== null) {
      window.clearTimeout(projectionRecoveryTimer.current);
      projectionRecoveryTimer.current = null;
    }
    projectionRecoveryGeneration.current += 1;
    dispatch({ type: "error.set", error: null });
    recoverProjection(projectionRecoveryGeneration.current, 0);
  }, [dispatch, recoverProjection]);

  const handleDisconnect = useCallback(
    (projectionReset: boolean) => {
      if (
        !shouldRefreshProjectionAfterDisconnect(
          projectionReset,
          document.visibilityState
        )
      ) {
        return;
      }
      if (projectionReset) {
        armProjectionRecovery();
        return;
      }
      void refresh().catch((error) =>
        dispatch({ type: "error.set", error })
      );
    },
    [armProjectionRecovery, dispatch, refresh]
  );

  const handleConnectionStateChange = useCallback(
    (connectionState: ConnectionState) => {
      dispatch({ type: "connection.set", state: connectionState });
    },
    [dispatch]
  );
  const handleConnectionError = useCallback(
    (error: unknown) => dispatch({ type: "error.set", error }),
    [dispatch]
  );
  const handleSynchronized = useCallback(
    () => dispatch({ type: "error.set", error: null }),
    [dispatch]
  );

  useSessionConnection({
    sessionId: id,
    enabled: currentSnapshot !== null,
    getResumeSequence,
    onSnapshot: acceptSynchronizedSnapshot,
    onEvent: handleRealtimeEvent,
    onError: handleConnectionError,
    onSynchronized: handleSynchronized,
    onConnectionStateChange: handleConnectionStateChange,
    onProjectionReset: resetProjection,
    onDisconnect: handleDisconnect
  });

  useEffect(() => {
    function clearWhenVisible() {
      if (document.visibilityState === "visible") clearSessionUnread(id);
    }
    clearWhenVisible();
    document.addEventListener("visibilitychange", clearWhenVisible);
    window.addEventListener("focus", clearWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", clearWhenVisible);
      window.removeEventListener("focus", clearWhenVisible);
    };
  }, [id]);

  const projectionUnavailable =
    currentSnapshot === null && state.error !== null;
  useEffect(() => {
    if (!projectionUnavailable) return;
    const rearm = () => armProjectionRecovery();
    const rearmWhenVisible = () => {
      if (document.visibilityState === "visible") rearm();
    };
    window.addEventListener("online", rearm);
    window.addEventListener("focus", rearmWhenVisible);
    document.addEventListener("visibilitychange", rearmWhenVisible);
    return () => {
      window.removeEventListener("online", rearm);
      window.removeEventListener("focus", rearmWhenVisible);
      document.removeEventListener("visibilitychange", rearmWhenVisible);
    };
  }, [armProjectionRecovery, projectionUnavailable]);

  useEffect(
    () => () => {
      projectionRecoveryGeneration.current += 1;
      if (projectionRecoveryTimer.current !== null) {
        window.clearTimeout(projectionRecoveryTimer.current);
        projectionRecoveryTimer.current = null;
      }
    },
    [id]
  );

  const {
    control,
    replayLastPrompt,
    exportSession,
    forkSession,
    deleteSession,
    sessionMutationBusy
  } = useSessionControls({
    sessionId: id,
    snapshot: currentSnapshot,
    dispatch,
    refresh
  });

  if (state.error && !currentSnapshot) {
    return (
      <div className={ui("session-route-error")}>
        <div>
          <p className={ui("eyebrow")}>SESSION</p>
          <h1>{t("无法打开会话")}</h1>
        </div>
        <ErrorBanner error={state.error} />
        <div className={ui("session-route-error-actions")}>
          <Button onClick={armProjectionRecovery}>
            {t("重新连接")}
          </Button>
          <ButtonLink to="/sessions" variant="secondary">
            {t("返回会话列表")}
          </ButtonLink>
        </div>
      </div>
    );
  }
  if (!currentSnapshot) return <Loading label={t("恢复会话快照")} />;

  return (
    <SessionDetailView
      sessionId={id}
      state={state}
      onError={(error) => dispatch({ type: "error.set", error })}
      onSessionRenamed={(session) =>
        dispatch({ type: "session.updated", session })
      }
      onControl={control}
      onReplayLastPrompt={replayLastPrompt}
      onExport={exportSession}
      onFork={forkSession}
      onDelete={deleteSession}
      sessionMutationBusy={sessionMutationBusy}
      onLoadEarlier={loadEarlier}
      onRetried={async () => {
        await refresh();
      }}
      onRuntimeUpdated={async () => {
        await refresh();
      }}
    />
  );
}
