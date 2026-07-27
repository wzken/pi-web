import { useEffect } from "react";
import { ErrorBanner, Loading } from "../components";
import { SessionDetailView } from "../features/session-detail/components/SessionDetailView";
import { useSessionConnection } from "../features/session-detail/hooks/useSessionConnection";
import { useSessionControls } from "../features/session-detail/hooks/useSessionControls";
import { useSessionState } from "../features/session-detail/hooks/useSessionState";
import { useParams } from "../router";
import { clearSessionUnread } from "../notifications";
import { t } from "../i18n";
import { ui } from "../ui";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const {
    state,
    dispatch,
    refresh,
    scheduleRefresh,
    loadEarlier,
    activeSessionId,
    latestSequence
  } = useSessionState(id);
  const currentSnapshot =
    state.snapshot?.session.id === id ? state.snapshot : null;

  useSessionConnection({
    sessionId: id,
    connectedSessionId: currentSnapshot?.session.id,
    sessionDisplayName: currentSnapshot?.session.displayName,
    dispatch,
    activeSessionId,
    latestSequence,
    refresh,
    scheduleRefresh
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

  const { control, replayLastPrompt, exportSession } = useSessionControls({
    sessionId: id,
    snapshot: currentSnapshot,
    dispatch,
    refresh
  });

  if (state.error && !currentSnapshot) {
    return (
      <div className={ui("session-route-error")}>
        <ErrorBanner error={state.error} />
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
      onLoadEarlier={loadEarlier}
      onRetried={async () => {
        dispatch({ type: "session.status", status: "starting" });
        await refresh();
      }}
      onSent={() => {
        dispatch({ type: "liveText.clear" });
        dispatch({ type: "session.status", status: "running" });
      }}
      onRuntimeUpdated={async () => {
        await refresh();
      }}
    />
  );
}
