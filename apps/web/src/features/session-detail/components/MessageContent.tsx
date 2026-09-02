import type { PiContentBlock, PiMessage } from "@pi-web/protocol";
import {
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
import { useId, useState, type ReactNode } from "react";
import {
  ActionMenu,
  ActionMenuItem,
  Dialog,
  IconButton
} from "../../../components";
import { t } from "../../../i18n";
import { messageToPlainText, type RetryablePrompt } from "../../../session-messages";
import { ui } from "../../../ui";
import type { ActivityItem } from "../types";
import { pretty } from "../utils/session-parsing";
import { DiffCard, toolResultDiff, writeCallDiff } from "./DiffCard";
import { Markdown } from "./Markdown";
import { messageStorageKey, type ToolResultGroupItem } from "./timeline-items";

export function ToolResultGroup({ messages }: { messages: ToolResultGroupItem[] }) {
  const failed = messages.filter(({ message }) => message.isError === true).length;
  const names = [...new Set(messages.map(({ message }) => toolResultName(message)))];
  const label =
    messages.length === 1
      ? names[0]
      : `${names.join(" · ")} · ${messages.length}`;
  return (
    <article className={ui("message tool-result-message")}>
      <div className={ui("message-avatar")}>
        <Wrench size={15} />
      </div>
      <div className={ui("message-body")}>
        <LazyDetails
          className={ui(`tool-block tool-result-block${failed ? " has-error" : ""}`)}
          summary={
            <>
              <Braces size={15} />
              <strong>{label}</strong>
              <span>
                {failed > 0
                  ? t("{{count}} 个工具结果，其中 {{failed}} 个失败", {
                      count: messages.length,
                      failed
                    })
                  : t("{{count}} 个工具结果", { count: messages.length })}
              </span>
              <ChevronDown size={14} />
            </>
          }
        >
          <div className={ui("tool-result-items")}>
            {messages.map(({ message, messageIndex }) => {
              const text = toolResultText(message);
              const diff = toolResultDiff(message, text);
              return (
                <section
                  className={ui(`tool-result-item${message.isError === true ? " is-error" : ""}`)}
                  key={`${messageStorageKey(message)}-${messageIndex}`}
                >
                  {messages.length > 1 && (
                    <header>
                      <strong>{toolResultName(message)}</strong>
                      <span>{message.isError === true ? t("执行失败") : t("已完成")}</span>
                    </header>
                  )}
                  {diff ? <DiffCard text={diff} /> : <pre>{text}</pre>}
                </section>
              );
            })}
          </div>
        </LazyDetails>
      </div>
    </article>
  );
}

function toolResultName(message: PiMessage): string {
  return typeof message.toolName === "string" && message.toolName.trim()
    ? message.toolName.trim()
    : t("工具结果");
}

function toolResultText(message: PiMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return pretty(message);
}

export function MessageCard({
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

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API but deny access.
    }
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
  const groupedBlocks = groupContentBlocks(content);
  return (
    <>
      {groupedBlocks.map((item, index) =>
        item.kind === "tool-calls" ? (
          <ToolCallGroup
            blocks={item.blocks}
            key={`tool-calls-${index}`}
          />
        ) : (
          <ContentBlock block={item.block} key={`${item.block.type}-${index}`} />
        )
      )}
    </>
  );
}

type GroupedContentBlock =
  | { kind: "block"; block: PiContentBlock }
  | { kind: "tool-calls"; blocks: PiContentBlock[] };

function groupContentBlocks(blocks: PiContentBlock[]): GroupedContentBlock[] {
  const grouped: GroupedContentBlock[] = [];
  let pending: PiContentBlock[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    grouped.push({ kind: "tool-calls", blocks: pending });
    pending = [];
  };
  for (const block of blocks) {
    if (["toolCall", "tool_call"].includes(block.type)) {
      pending.push(block);
      continue;
    }
    flush();
    grouped.push({ kind: "block", block });
  }
  flush();
  return grouped;
}

function ToolCallGroup({ blocks }: { blocks: PiContentBlock[] }) {
  const names = [...new Set(blocks.map((block) => String(block.name ?? t("工具调用"))))];
  const label =
    blocks.length === 1
      ? names[0]
      : `${names.join(" · ")} · ${blocks.length}`;
  return (
    <LazyDetails
      className={ui("tool-block tool-call-group")}
      summary={
        <>
          <Wrench size={15} />
          <strong>{label}</strong>
          <span>{t("{{count}} 个工具调用", { count: blocks.length })}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      <div className={ui("tool-call-items")}>
        {blocks.map((block, index) => {
          const write = writeCallDiff(block);
          return (
            <section className={ui("tool-call-item")} key={`${String(block.id ?? block.name ?? "tool")}-${index}`}>
              {blocks.length > 1 && <header>{String(block.name ?? t("工具调用"))}</header>}
              {write ? (
                <DiffCard title={write.path} text={write.diff} />
              ) : (
                <pre>{pretty(block.arguments ?? block)}</pre>
              )}
            </section>
          );
        })}
      </div>
    </LazyDetails>
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
      <LazyDetails
        className={ui("thinking-block")}
        summary={
          <>
            <span className={ui("spark-icon")}>✦</span>
            {t("思考过程")}
            <ChevronDown size={14} />
          </>
        }
      >
        <Markdown>{String(block.thinking ?? block.text)}</Markdown>
      </LazyDetails>
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
  return (
    <LazyDetails
      className={ui("tool-block subtle")}
      summary={
        <>
          <Braces size={15} />
          {block.type}
          <ChevronDown size={14} />
        </>
      }
    >
      <pre>{pretty(block)}</pre>
    </LazyDetails>
  );
}

function LazyDetails({
  className,
  summary,
  children
}: {
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      {open ? children : null}
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
          loading="lazy"
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
          <img
            src={source}
            alt={t("Pi 会话图片")}
            decoding="async"
          />
        </div>
      </Dialog>
    </>
  );
}

export function ToolActivity({ activity }: { activity: ActivityItem }) {
  const payload = prettyActivityPayload(activity.payload);
  const statusLabel =
    activity.status === "done"
      ? t("已完成")
      : activity.status === "error"
        ? t("执行失败")
        : t("正在执行");
  return (
    <article className={ui(`message tool-activity tool-${activity.status}`)}>
      <div className={ui("message-avatar")}>
        <Wrench size={15} />
      </div>
      <div className={ui("message-body")}>
        <div className={ui("tool-live-line")}>
          <span className={ui("pulse-dot")} aria-hidden="true" />
          <strong>{activity.name}</strong>
          <span>{statusLabel}</span>
        </div>
        {payload && (
          <LazyDetails
            className={ui("tool-output-preview")}
            summary={
              <>
                <Braces size={14} />
                {t("输出预览")}
                <ChevronDown size={14} />
              </>
            }
          >
            <pre>{payload}</pre>
          </LazyDetails>
        )}
      </div>
    </article>
  );
}

function prettyActivityPayload(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const output = (value as Record<string, unknown>).outputPreview;
  return typeof output === "string" ? output : "";
}
