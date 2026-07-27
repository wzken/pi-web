import type {
  SessionRecord,
  SessionStatus
} from "@pi-web/protocol";
import { FolderOpen, WifiOff } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBanner, Loading } from "../../../components";
import { useWorkbenchRail } from "../../../SessionNavigator";
import {
  extractRetryablePrompt,
  type RetryablePrompt
} from "../../../session-messages";
import type {
  SessionControlAction,
  SessionDetailState
} from "../types";
import { t } from "../../../i18n";
import { Composer } from "./Composer";
import { FileBrowser } from "./FileBrowser";
import { MessageTimeline } from "./MessageTimeline";
import { RetryLastPrompt } from "./RetryLastPrompt";
import { SessionHeader } from "./SessionHeader";
import { SessionRail } from "./SessionRail";
import { SessionSystemPanel } from "./SessionSystemPanel";
import { SessionTreePanel } from "./SessionTreePanel";
import { ui } from "../../../ui";

const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel
  }))
);

interface SessionDetailViewProps {
  sessionId: string;
  state: SessionDetailState;
  onError: (error: unknown) => void;
  onSessionRenamed: (session: SessionRecord) => void;
  onControl: (action: SessionControlAction) => Promise<boolean>;
  onReplayLastPrompt: (
    prompt: RetryablePrompt,
    status: SessionStatus
  ) => Promise<void>;
  onExport: () => void;
  onLoadEarlier: () => Promise<void>;
  onRetried: () => Promise<void>;
  onSent: () => void;
  onRuntimeUpdated: () => Promise<void>;
}

export function SessionDetailView({
  sessionId,
  state,
  onError,
  onSessionRenamed,
  onControl,
  onReplayLastPrompt,
  onExport,
  onLoadEarlier,
  onRetried,
  onSent,
  onRuntimeUpdated
}: SessionDetailViewProps) {
  const [filesOpen, setFilesOpen] = useState(false);
  const [railOpen, setRailOpen] = useWorkbenchRail();
  const [systemOpen, setSystemOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const { snapshot } = state;

  useEffect(() => {
    setTerminalCollapsed(false);
  }, [sessionId]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setRailOpen((value) => !value);
      } else if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((value) => {
          if (!value) setTerminalCollapsed(false);
          return !value;
        });
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [setRailOpen]);

  if (!snapshot) return null;
  const { session } = snapshot;
  const retryablePrompt = extractRetryablePrompt(
    snapshot.messages,
    session.status
  );

  return (
    <div
      className={ui(`session-workbench${railOpen ? "" : " rail-collapsed"}${
        filesOpen ? "" : " files-collapsed"
      }`)}
    >
      {railOpen && (
        <>
          <SessionRail
            currentId={sessionId}
            cwd={session.cwd}
            onSessionRenamed={onSessionRenamed}
          />
          <button
            className={ui("workbench-rail-backdrop")}
            aria-label={t("收起会话栏")}
            onClick={() => setRailOpen(false)}
          />
        </>
      )}
      <section className={ui("conversation-pane")}>
        <SessionHeader
          snapshot={snapshot}
          clock={state.clock}
          railOpen={railOpen}
          filesOpen={filesOpen}
          systemOpen={systemOpen}
          treeOpen={treeOpen}
          terminalOpen={terminalOpen}
          treeAvailable={Boolean(snapshot.tree?.nodes.length)}
          replayBusy={state.replayBusy}
          controlBusy={state.controlBusy}
          onToggleRail={() => setRailOpen((value) => !value)}
          onToggleFiles={() => setFilesOpen((value) => !value)}
          onToggleSystem={() => {
            setTreeOpen(false);
            setSystemOpen((value) => !value);
          }}
          onToggleTree={() => {
            setSystemOpen(false);
            setTreeOpen((value) => !value);
          }}
          onToggleTerminal={() => {
            setSystemOpen(false);
            setTreeOpen(false);
            setTerminalOpen((value) => {
              if (!value) setTerminalCollapsed(false);
              return !value;
            });
          }}
          onExport={onExport}
          onControl={onControl}
          onReplayLastPrompt={onReplayLastPrompt}
        />

        {state.connectionState !== "connected" && (
          <div className={ui("connection-banner")} role="status">
            <WifiOff size={14} />
            <span>
              {state.connectionState === "reconnecting"
                ? t("实时连接已断开，正在重新连接。草稿已保留。")
                : t("正在建立实时连接…")}
            </span>
          </div>
        )}

        {systemOpen && <SessionSystemPanel snapshot={snapshot} />}
        {treeOpen && snapshot.tree && (
          <SessionTreePanel tree={snapshot.tree} />
        )}

        {state.error !== null && (
          <div className={ui("session-error-banner")}>
            <ErrorBanner error={state.error} onDismiss={() => onError(null)} />
          </div>
        )}

        <div
          className={ui(`conversation-body${terminalOpen ? " terminal-visible" : ""}${
            terminalCollapsed ? " terminal-collapsed" : ""
          }`)}
        >
          <MessageTimeline
            messages={snapshot.messages}
            activities={state.activities}
            liveText={state.liveText}
            running={
              session.status === "running" || session.status === "stopping"
            }
            truncated={snapshot.truncated}
            onLoadEarlier={onLoadEarlier}
          />
          {terminalOpen && (
            <Suspense fallback={<Loading label={t("载入终端")} />}>
              {!terminalCollapsed && (
                <button
                  type="button"
                  className={ui("terminal-sheet-backdrop")}
                  aria-label={t("点击背景缩回终端")}
                  onClick={() => setTerminalCollapsed(true)}
                />
              )}
              <TerminalPanel
                key={sessionId}
                sessionId={sessionId}
                cwd={session.cwd}
                collapsed={terminalCollapsed}
                onCollapse={() => setTerminalCollapsed(true)}
                onExpand={() => setTerminalCollapsed(false)}
                onClose={() => {
                  setTerminalCollapsed(false);
                  setTerminalOpen(false);
                }}
              />
            </Suspense>
          )}
        </div>

        <div className={ui("composer-shell")}>
          {retryablePrompt && (
            <RetryLastPrompt
              sessionId={sessionId}
              prompt={retryablePrompt}
              onError={onError}
              onRetried={onRetried}
            />
          )}
          <Composer
            key={sessionId}
            sessionId={sessionId}
            cwd={session.cwd}
            status={session.status}
            model={session.model}
            thinkingLevel={session.thinkingLevel}
            connected={state.connectionState === "connected"}
            queuedMessages={state.queuedMessages}
            onAbort={() => onControl("abort")}
            onSent={onSent}
            onError={onError}
            onRuntimeUpdated={onRuntimeUpdated}
          />
        </div>
      </section>

      {filesOpen && (
        <>
          <button
            className={ui("file-pane-backdrop")}
            aria-label={t("关闭文件面板")}
            onClick={() => setFilesOpen(false)}
          />
          <aside className={ui("file-pane file-pane-open")}>
            <FileBrowser
              key={`pane-files:${sessionId}`}
              sessionId={sessionId}
              cwd={session.cwd}
              onClose={() => setFilesOpen(false)}
            />
          </aside>
        </>
      )}
      {!filesOpen && !terminalOpen && (
        <button
          className={ui("mobile-file-fab")}
          onClick={() => setFilesOpen(true)}
          aria-label={t("打开文件")}
        >
          <FolderOpen size={20} />
        </button>
      )}
    </div>
  );
}
