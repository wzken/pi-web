import type {
  SessionSnapshot,
  SessionStatus
} from "@pi-web/protocol";
import {
  Download,
  GitBranch,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCcw,
  TerminalSquare,
  X
} from "lucide-react";
import { formatCost, formatNumber } from "../../../api";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  IconButton,
  StatusDot
} from "../../../components";
import {
  extractLastUserPrompt,
  extractRetryablePrompt,
  type RetryablePrompt
} from "../../../session-messages";
import type {
  SessionControlAction
} from "../types";
import { formatElapsed } from "../utils/session-formatting";
import { asRecord } from "../utils/session-parsing";
import { getLocale, t } from "../../../i18n";
import { ui } from "../../../ui";

interface SessionHeaderProps {
  snapshot: SessionSnapshot;
  clock: number;
  railOpen: boolean;
  filesOpen: boolean;
  systemOpen: boolean;
  treeOpen: boolean;
  terminalOpen: boolean;
  treeAvailable: boolean;
  replayBusy: boolean;
  controlBusy: SessionControlAction | null;
  onToggleRail: () => void;
  onToggleFiles: () => void;
  onToggleSystem: () => void;
  onToggleTree: () => void;
  onToggleTerminal: () => void;
  onExport: () => void;
  onControl: (action: SessionControlAction) => Promise<boolean>;
  onReplayLastPrompt: (
    prompt: RetryablePrompt,
    status: SessionStatus
  ) => Promise<void>;
}

export function SessionHeader({
  snapshot,
  clock,
  railOpen,
  filesOpen,
  systemOpen,
  treeOpen,
  terminalOpen,
  treeAvailable,
  replayBusy,
  controlBusy,
  onToggleRail,
  onToggleFiles,
  onToggleSystem,
  onToggleTree,
  onToggleTerminal,
  onExport,
  onControl,
  onReplayLastPrompt
}: SessionHeaderProps) {
  const { session } = snapshot;
  const active = ["starting", "running", "waiting", "stopping"].includes(
    session.status
  );
  const sessionStats = asRecord(asRecord(snapshot.state).sessionStats);
  const contextUsage = asRecord(sessionStats.contextUsage);
  const contextPercent =
    typeof contextUsage.percent === "number" &&
    Number.isFinite(contextUsage.percent)
      ? contextUsage.percent
      : null;
  const contextTokens =
    typeof contextUsage.tokens === "number" ? contextUsage.tokens : null;
  const contextWindow =
    typeof contextUsage.contextWindow === "number"
      ? contextUsage.contextWindow
      : null;
  const lastUserPrompt = extractLastUserPrompt(snapshot.messages);
  const retryablePrompt = extractRetryablePrompt(
    snapshot.messages,
    session.status
  );
  const canReplayLast =
    lastUserPrompt !== null &&
    ["waiting", "failed", "interrupted", "closed"].includes(session.status);

  return (
    <header className={ui("session-header")}>
      <IconButton
        label={railOpen ? t("收起会话栏") : t("展开会话栏")}
        tooltip={t("{{action}}会话栏（Ctrl+B）", {
          action: railOpen ? t("收起") : t("展开")
        })}
        variant="toolbar"
        onClick={onToggleRail}
      >
        {railOpen ? (
          <PanelLeftClose size={17} />
        ) : (
          <PanelLeftOpen size={17} />
        )}
      </IconButton>
      <Button
        className={ui("session-export-button")}
        variant="toolbar"
        size="sm"
        onClick={onExport}
      >
        <Download size={14} />
        {t("导出")}
      </Button>
      <Button
        variant="toolbar"
        size="sm"
        className={ui("session-system-button")}
        active={systemOpen}
        onClick={onToggleSystem}
      >
        <Info size={14} />
        {t("系统")}
      </Button>
      {treeAvailable && (
        <Button
          variant="toolbar"
          size="sm"
          className={ui("session-tree-button")}
          active={treeOpen}
          onClick={onToggleTree}
        >
          <GitBranch size={14} />
          {t("分支")}
        </Button>
      )}
      <Button
        variant="toolbar"
        size="sm"
        className={ui("session-terminal-button")}
        active={terminalOpen}
        onClick={onToggleTerminal}
        title={`${t("终端")} (Ctrl/⌘+\`)`}
      >
        <TerminalSquare size={14} />
        {t("终端")}
      </Button>
      <div className={ui("session-title")}>
        <div className={ui("session-title-line")}>
          <h1>{session.displayName}</h1>
          <StatusDot status={session.status} />
        </div>
        <p title={session.cwd}>{session.cwd}</p>
      </div>
      <div className={ui("session-usage")}>
        <span>
          <b>{formatNumber(session.inputTokens + session.outputTokens)}</b>{" "}
          token
        </span>
        <span>
          <b>{session.toolCalls}</b> tools
        </span>
        <span
          title={
            contextTokens !== null && contextWindow !== null
              ? `${formatNumber(contextTokens)} / ${formatNumber(
                  contextWindow
                )} token`
              : t("当前 Pi 未报告上下文占用")
          }
        >
          <b>
            {contextPercent === null ? "—" : `${contextPercent.toFixed(1)}%`}
          </b>{" "}
          context
        </span>
        <span title={t("开始于 {{date}}", {
          date: new Date(session.startedAt).toLocaleString(getLocale())
        })}>
          <b>{formatElapsed(session.startedAt, session.endedAt, clock)}</b>{" "}
          duration
        </span>
        <span title={t("成本状态：{{status}}", { status: session.costStatus })}>
          <b>{formatCost(session.reportedCost ?? session.estimatedCost)}</b>{" "}
          {session.costStatus === "estimated" ? "estimated" : "cost"}
        </span>
      </div>
      <div className={ui("session-controls")}>
        {!active && (
          <Button
            variant="toolbar"
            size="sm"
            loading={controlBusy === "resume"}
            loadingLabel={t("恢复中…")}
            disabled={controlBusy !== null}
            onClick={() => void onControl("resume")}
          >
            <Play size={16} />
            {t("恢复")}
          </Button>
        )}
        {active && (
          <Button
            variant="toolbar"
            size="sm"
            aria-label={t("关闭会话")}
            loading={controlBusy === "close"}
            loadingLabel={t("关闭中…")}
            disabled={controlBusy !== null}
            onClick={() => {
              if (
                window.confirm(
                  t("关闭会释放当前 Pi Worker。历史仍会保留，之后可以恢复。继续吗？")
                )
              ) {
                void onControl("close");
              }
            }}
          >
            <X size={16} />
            {t("关闭")}
          </Button>
        )}
        {canReplayLast && !retryablePrompt && lastUserPrompt && (
          <ActionMenu label={t("更多会话操作")}>
            <ActionMenuItem
              disabled={replayBusy}
              onClick={() =>
                void onReplayLastPrompt(lastUserPrompt, session.status)
              }
            >
              <RefreshCcw size={14} />
              {replayBusy ? t("正在重新发送…") : t("重新发送最后一条")}
            </ActionMenuItem>
          </ActionMenu>
        )}
        <IconButton
          className={ui("desktop-file-toggle")}
          variant="toolbar"
          active={filesOpen}
          onClick={onToggleFiles}
          label={filesOpen ? t("关闭文件面板") : t("打开文件面板")}
        >
          {filesOpen ? (
            <PanelRightClose size={18} />
          ) : (
            <PanelRightOpen size={18} />
          )}
        </IconButton>
      </div>
    </header>
  );
}
