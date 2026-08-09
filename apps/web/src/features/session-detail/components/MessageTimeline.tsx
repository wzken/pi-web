import type { PiContentBlock, PiMessage, SessionStatus } from "@pi-web/protocol";
import {
  ArrowDown,
  Bot,
  Braces,
  ChevronDown,
  Copy,
  Download,
  ImageOff,
  LoaderCircle,
  Maximize2,
  RefreshCcw,
  Trash2,
  X,
  Wrench
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  ActionMenu,
  ActionMenuItem,
  Button,
  Dialog,
  IconButton,
  useToast
} from "../../../components";
import type { ActivityItem } from "../types";
import {
  extractLastUserPrompt,
  extractRetryablePrompt,
  messageToPlainText,
  type RetryablePrompt
} from "../../../session-messages";
import { pretty } from "../utils/session-parsing";
import { Markdown } from "./Markdown";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface MessageTimelineProps {
  messages: PiMessage[];
  sessionId: string;
  firstItemIndex: number;
  activities: ActivityItem[];
  liveText: string;
  running: boolean;
  status: SessionStatus;
  replayBusy: boolean;
  truncated: boolean;
  onLoadEarlier: () => Promise<void>;
  onReplayPrompt: (prompt: RetryablePrompt, status: SessionStatus) => Promise<void>;
}

export function MessageTimeline({
  messages,
  sessionId,
  firstItemIndex,
  activities,
  liveText,
  running,
  status,
  replayBusy,
  truncated,
  onLoadEarlier,
  onReplayPrompt
}: MessageTimelineProps) {
  const toast = useToast();
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hiddenMessageKeys, setHiddenMessageKeys] = useState<Set<string>>(
    () => readHiddenMessages(sessionId)
  );
  useEffect(() => setHiddenMessageKeys(readHiddenMessages(sessionId)), [sessionId]);
  const items = useMemo(() => {
    const base: Array<
      | { kind: "message"; key: string; message: PiMessage; messageIndex: number }
      | { kind: "activity"; key: string; activity: ActivityItem }
      | { kind: "live"; key: string; text: string }
    > = messages.flatMap((message, index) => {
      const key = messageStorageKey(message);
      if (hiddenMessageKeys.has(key)) return [];
      return [{ kind: "message" as const, key, message, messageIndex: index }];
    });
    for (const activity of activities.filter(
      (item) => item.status === "running"
    )) {
      base.push({
        kind: "activity",
        key: `activity-${activity.id}`,
        activity
      });
    }
    if (running && liveText) {
      base.push({ kind: "live", key: "live", text: liveText });
    }
    return base;
  }, [activities, hiddenMessageKeys, liveText, messages, running]);

  function hideMessage(message: PiMessage) {
    if (!window.confirm(t("删除这条回复？它只会从当前浏览器隐藏，Pi 原始记录仍会保留。"))) {
      return;
    }
    const key = messageStorageKey(message);
    setHiddenMessageKeys((current) => {
      const next = new Set(current).add(key);
      writeHiddenMessages(sessionId, next);
      return next;
    });
    toast.push(t("回复已从当前浏览器隐藏"), "success");
  }

  async function loadEarlier() {
    if (loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      await onLoadEarlier();
    } finally {
      setLoadingEarlier(false);
    }
  }

  return (
    <div className={ui("message-area")}>
      {truncated && (
        <Button
          className={ui("load-earlier")}
          variant="ghost"
          size="sm"
          loading={loadingEarlier}
          loadingLabel={t("载入中…")}
          onClick={() => void loadEarlier()}
        >
          {t("加载更早消息")}
        </Button>
      )}
      <Virtuoso
        ref={virtuoso}
        className={ui("message-virtuoso")}
        data={items}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        alignToBottom
        computeItemKey={(_, item) => item.key}
        followOutput={atBottom ? "smooth" : false}
        atBottomStateChange={setAtBottom}
        itemContent={(_, item) => {
          if (item.kind === "message") {
            const isLast = item.messageIndex === messages.length - 1;
            const retryPrompt = isLast
              ? item.message.role === "assistant"
                ? extractLastUserPrompt(messages)
                : extractRetryablePrompt(messages, status)
              : null;
            return (
              <MessageCard
                message={item.message}
                retryPrompt={retryPrompt}
                replayBusy={replayBusy}
                onReplay={() => retryPrompt && onReplayPrompt(retryPrompt, status)}
                onDelete={() => hideMessage(item.message)}
                onNotice={(message, tone) => toast.push(message, tone)}
              />
            );
          }
          if (item.kind === "activity") {
            return <ToolActivity activity={item.activity} />;
          }
          return (
            <article className={ui("message assistant live-message")}>
              <div className={ui("message-avatar")}>
                <Bot size={16} />
              </div>
              <div className={ui("message-body")}>
                <div className={ui("message-label")}>{t("Pi 正在回复")}</div>
                <Markdown>{item.text}</Markdown>
                <span className={ui("typing-cursor")} />
              </div>
            </article>
          );
        }}
        components={{
          EmptyPlaceholder: () => (
            <div className={ui("conversation-empty")}>
              <div className={ui("empty-orbit")}>
                <Bot size={24} />
              </div>
              <h2>{t("会话已就绪")}</h2>
              <p>{t("在下方输入任务，Pi 会在这个工作目录中开始行动。")}</p>
            </div>
          ),
          Footer: () => <div className={ui("message-footer-space")} />
        }}
      />
      {!atBottom && (
        <button
          className={ui("scroll-bottom")}
          onClick={() =>
            virtuoso.current?.scrollToIndex({
              index: "LAST",
              align: "end",
              behavior: "smooth"
            })
          }
        >
          <ArrowDown size={15} />
          {t("回到底部")}
        </button>
      )}
    </div>
  );
}

function MessageCard({
  message,
  retryPrompt,
  replayBusy,
  onReplay,
  onDelete,
  onNotice
}: {
  message: PiMessage;
  retryPrompt: RetryablePrompt | null;
  replayBusy: boolean;
  onReplay: () => void;
  onDelete: () => void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const role = message.role;
  const assistant = role === "assistant";
  const text = messageToPlainText(message);
  const actionable = assistant && Boolean(text);

  async function copyMessage() {
    try {
      await copyText(text);
      onNotice(t("消息已复制"), "success");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function downloadMessage() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pi-message-${role}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <article className={ui(`message ${assistant ? "assistant" : role}`)}>
      <div className={ui("message-avatar")}>
        {assistant ? (
          <Bot size={16} />
        ) : role === "user" ? (
          t("你")
        ) : (
          <Wrench size={15} />
        )}
      </div>
      <div className={ui("message-body")}>
        <div className={ui("message-label")}>
          {assistant ? message.model || "Pi" : role === "user" ? t("你") : role}
        </div>
        <MessageContent message={message} />
        {assistant && message.stopReason && (
          <div className={ui("message-footnote")}>{message.stopReason}</div>
        )}
        {actionable && (
          <div className={ui("message-actions")} aria-label={t("消息操作")}>
            <IconButton size="sm" label={t("复制消息")} onClick={() => void copyMessage()}>
              <Copy size={15} />
            </IconButton>
            <IconButton size="sm" label={t("删除回复")} onClick={onDelete}>
              <Trash2 size={15} />
            </IconButton>
            {retryPrompt && (
              <IconButton
                size="sm"
                label={t("重试消息")}
                disabled={replayBusy}
                onClick={onReplay}
              >
                <RefreshCcw size={15} />
              </IconButton>
            )}
            <ActionMenu label={t("更多消息操作")}>
              <ActionMenuItem onClick={downloadMessage}>
                <Download size={15} />
                {t("导出消息")}
              </ActionMenuItem>
            </ActionMenu>
          </div>
        )}
      </div>
    </article>
  );
}

function hiddenMessagesStorageKey(sessionId: string): string {
  return `pi-web:hidden-messages:${sessionId}`;
}

function readHiddenMessages(sessionId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(hiddenMessagesStorageKey(sessionId)) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHiddenMessages(sessionId: string, keys: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(hiddenMessagesStorageKey(sessionId), JSON.stringify([...keys]));
  } catch {
    // Hiding remains available for this page when browser storage is unavailable.
  }
}

function messageStorageKey(message: PiMessage): string {
  const source = `${message.role}\u0000${String(message.timestamp ?? "")}\u0000${messageToPlainText(message)}\u0000${String(message.model ?? "")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `message-${(hash >>> 0).toString(36)}`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error(t("无法复制消息"));
}

function MessageContent({ message }: { message: PiMessage }) {
  const { content } = message;
  if (typeof content === "string") return <Markdown>{content}</Markdown>;
  if (!Array.isArray(content)) {
    if (typeof message.summary === "string") {
      return <Markdown>{message.summary}</Markdown>;
    }
    return <pre>{pretty(message)}</pre>;
  }
  return (
    <>
      {content.map((block, index) => (
        <ContentBlock block={block} key={`${block.type}-${index}`} />
      ))}
    </>
  );
}

function ContentBlock({ block }: { block: PiContentBlock }) {
  if (block.type === "text" && typeof block.text === "string") {
    return <Markdown>{block.text}</Markdown>;
  }
  if (
    (block.type === "thinking" || block.type === "reasoning") &&
    (typeof block.thinking === "string" || typeof block.text === "string")
  ) {
    return (
      <details className={ui("thinking-block")}>
        <summary>
          <span className={ui("spark-icon")}>✦</span>
          {t("思考过程")}
          <ChevronDown size={14} />
        </summary>
        <div>{String(block.thinking ?? block.text)}</div>
      </details>
    );
  }
  if (
    block.type === "image" &&
    typeof block.data === "string" &&
    typeof block.mimeType === "string" &&
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      block.mimeType
    )
  ) {
    return <MessageImage mimeType={block.mimeType} data={block.data} />;
  }
  if (["toolCall", "tool_call"].includes(block.type)) {
    return (
      <details className={ui("tool-block")}>
        <summary>
          <Wrench size={15} />
          {String(block.name ?? t("工具调用"))}
          <ChevronDown size={14} />
        </summary>
        <pre>{pretty(block.arguments ?? block)}</pre>
      </details>
    );
  }
  return (
    <details className={ui("tool-block subtle")}>
      <summary>
        <Braces size={15} />
        {block.type}
        <ChevronDown size={14} />
      </summary>
      <pre>{pretty(block)}</pre>
    </details>
  );
}

function MessageImage({ mimeType, data }: { mimeType: string; data: string }) {
  const titleId = useId();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const source = `data:${mimeType};base64,${data}`;

  return (
    <>
      <button
        type="button"
        className={ui("message-image-button")}
        aria-label={t("展开图片")}
        disabled={failed}
        onClick={() => setOpen(true)}
      >
        <img
          className={ui("message-image")}
          src={source}
          alt={t("Pi 会话图片")}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(true);
            setFailed(true);
          }}
        />
        {!loaded && (
          <span className={ui("message-image-loading")} role="status">
            <LoaderCircle size={22} aria-hidden="true" />
            <span>{t("图片载入中")}</span>
          </span>
        )}
        {failed ? (
          <span className={ui("message-image-error")}>
            <ImageOff size={20} aria-hidden="true" />
            {t("图片无法显示")}
          </span>
        ) : (
          <span className={ui("message-image-expand")} aria-hidden="true">
            <Maximize2 size={15} />
          </span>
        )}
      </button>
      <Dialog
        open={open}
        labelledBy={titleId}
        className={ui("message-image-dialog")}
        maxWidth="min(96vw, 1100px)"
        onClose={() => setOpen(false)}
      >
        <header className={ui("message-image-dialog-heading")}>
          <h2 id={titleId}>{t("图片预览")}</h2>
          <IconButton label={t("关闭图片预览")} onClick={() => setOpen(false)}>
            <X size={18} />
          </IconButton>
        </header>
        <div className={ui("message-image-dialog-canvas")}>
          <img src={source} alt={t("Pi 会话图片")} />
        </div>
      </Dialog>
    </>
  );
}

function ToolActivity({ activity }: { activity: ActivityItem }) {
  return (
    <article className={ui("message tool-activity")}>
      <div className={ui("message-avatar")}>
        <Wrench size={15} />
      </div>
      <div className={ui("message-body")}>
        <div className={ui("tool-live-line")}>
          <span className={ui("pulse-dot")} />
          <strong>{activity.name}</strong>
          <span>{t("正在执行")}</span>
        </div>
      </div>
    </article>
  );
}
