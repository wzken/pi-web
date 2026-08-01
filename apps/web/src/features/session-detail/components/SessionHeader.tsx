import type {
  SessionSnapshot,
  SessionStatus
} from "@pi-web/protocol";
import {
  Braces,
  Cpu,
  Download,
  Gauge,
  GitBranch,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCcw,
  Settings,
  TerminalSquare,
  X
} from "lucide-react";
import { formatNumber } from "../../../api";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  ButtonLink,
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
import { asRecord } from "../utils/session-parsing";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface SessionHeaderProps {
  snapshot: SessionSnapshot;
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
  const sessionStats = asRecord(snapshot.sessionStats);
  const runtimeState = asRecord(snapshot.state);
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
  const effectiveSystemPrompt =
    typeof runtimeState.systemPrompt === "string"
      ? runtimeState.systemPrompt
      : null;
  const promptStatus =
    effectiveSystemPrompt !== null
      ? session.systemPrompt
        ? t("实际 + 附加")
        : t("实际")
      : session.systemPrompt
        ? t("已附加")
        : t("默认");
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
        className={ui("workbench-rail-toggle")}
        label={railOpen ? t("收起会话栏") : t("展开会话栏")}
        tooltip={t("{{action}}会话栏（Ctrl+B）", {
          action: railOpen ? t("收起") : t("展开")
        })}
        variant="toolbar"
        aria-expanded={railOpen}
        onClick={onToggleRail}
      >
        {railOpen ? (
          <PanelLeftClose size={17} />
        ) : (
          <PanelLeftOpen size={17} />
        )}
      </IconButton>
      <div className={ui("session-title")}>
        <div className={ui("session-title-line")}>
          <h1>{session.displayName}</h1>
          <StatusDot status={session.status} />
        </div>
        <p title={session.cwd}>{session.cwd}</p>
      </div>
      <div className={ui("session-usage")}>
        <span
          className={ui("session-fact session-model-fact")}
          title={session.model ?? t("Pi 默认模型")}
        >
          <Cpu size={13} aria-hidden="true" />
          <b>{shortModelName(session.model) || t("默认模型")}</b>
        </span>
        <span
          className={ui("session-fact session-token-fact")}
          title={t("输入 {{input}} · 输出 {{output}}", {
            input: formatNumber(session.inputTokens),
            output: formatNumber(session.outputTokens)
          })}
        >
          <span aria-hidden="true">Σ</span>
          <b>{formatNumber(session.inputTokens + session.outputTokens)}</b>
          <small>token</small>
        </span>
        <span
          className={ui("session-fact session-context-fact")}
          title={
            contextTokens !== null && contextWindow !== null
              ? `${formatNumber(contextTokens)} / ${formatNumber(
                  contextWindow
                )} token`
              : t("当前 Pi 未报告上下文占用")
          }
        >
          <Gauge size={13} aria-hidden="true" />
          <b>
            {contextPercent === null ? "—" : `${contextPercent.toFixed(1)}%`}
          </b>{" "}
          <small>context</small>
        </span>
        <Button
          type="button"
          className={ui("session-fact session-prompt-fact")}
          variant="toolbar"
          size="sm"
          active={systemOpen}
          aria-expanded={systemOpen}
          title={t(
            "系统提示词：{{system}}；附加提示词：{{additional}}。点击查看详情。",
            {
              system:
                effectiveSystemPrompt !== null ? t("已读取") : t("未报告"),
              additional: session.systemPrompt ? t("已设置") : t("无")
            }
          )}
          onClick={onToggleSystem}
        >
          <Braces size={13} aria-hidden="true" />
          <b>{t("提示词")}</b>
          <small>{promptStatus}</small>
        </Button>
      </div>
      <div className={ui("session-controls")}>
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
        <ButtonLink
          to="/settings"
          variant="toolbar"
          size="icon"
          className={ui("session-settings-link")}
          aria-label={t("设置")}
          title={t("设置")}
        >
          <Settings size={17} />
        </ButtonLink>
        <ActionMenu label={t("更多会话操作")}>
          {!active && (
            <ActionMenuItem
              disabled={controlBusy !== null}
              onClick={() => void onControl("resume")}
            >
              <Play size={14} />
              {controlBusy === "resume" ? t("恢复中…") : t("恢复")}
            </ActionMenuItem>
          )}
          <ActionMenuItem active={systemOpen} onClick={onToggleSystem}>
            <Info size={14} />
            {t("系统")}
          </ActionMenuItem>
          {treeAvailable && (
            <ActionMenuItem active={treeOpen} onClick={onToggleTree}>
              <GitBranch size={14} />
              {t("分支")}
            </ActionMenuItem>
          )}
          <ActionMenuItem
            active={terminalOpen}
            title={`${t("终端")} (Ctrl/⌘+\`)`}
            onClick={onToggleTerminal}
          >
            <TerminalSquare size={14} />
            {t("终端")}
          </ActionMenuItem>
          <ActionMenuItem onClick={onExport}>
            <Download size={14} />
            {t("导出")}
          </ActionMenuItem>
          {canReplayLast && !retryablePrompt && lastUserPrompt && (
            <ActionMenuItem
              disabled={replayBusy}
              onClick={() =>
                void onReplayLastPrompt(lastUserPrompt, session.status)
              }
            >
              <RefreshCcw size={14} />
              {replayBusy ? t("正在重新发送…") : t("重新发送最后一条")}
            </ActionMenuItem>
          )}
          {active && (
            <ActionMenuItem
              danger
              aria-label={t("关闭会话")}
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
              <X size={14} />
              {controlBusy === "close" ? t("关闭中…") : t("关闭")}
            </ActionMenuItem>
          )}
        </ActionMenu>
      </div>
    </header>
  );
}

function shortModelName(model: string | null): string {
  if (!model) return "";
  return model.split("/").at(-1) ?? model;
}
