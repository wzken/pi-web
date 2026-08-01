import type { PiContentBlock, PiMessage } from "@pi-web/protocol";
import {
  ArrowDown,
  Bot,
  Braces,
  ChevronDown,
  Wrench
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "../../../components";
import type { ActivityItem } from "../types";
import { pretty } from "../utils/session-parsing";
import { Markdown } from "./Markdown";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface MessageTimelineProps {
  messages: PiMessage[];
  firstItemIndex: number;
  activities: ActivityItem[];
  liveText: string;
  running: boolean;
  truncated: boolean;
  onLoadEarlier: () => Promise<void>;
}

export function MessageTimeline({
  messages,
  firstItemIndex,
  activities,
  liveText,
  running,
  truncated,
  onLoadEarlier
}: MessageTimelineProps) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const items = useMemo(() => {
    const base: Array<
      | { kind: "message"; key: string; message: PiMessage }
      | { kind: "activity"; key: string; activity: ActivityItem }
      | { kind: "live"; key: string; text: string }
    > = messages.map((message, index) => ({
      kind: "message",
      key: `message-${index}-${message.role}`,
      message
    }));
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
  }, [activities, liveText, messages, running]);

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
        computeItemKey={(index, item) =>
          item.kind === "message"
            ? `message-${index}-${item.message.role}`
            : item.key
        }
        followOutput={atBottom ? "smooth" : false}
        atBottomStateChange={setAtBottom}
        itemContent={(_, item) => {
          if (item.kind === "message") {
            return <MessageCard message={item.message} />;
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
              index: items.length - 1,
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

function MessageCard({ message }: { message: PiMessage }) {
  const role = message.role;
  const assistant = role === "assistant";
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
      </div>
    </article>
  );
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
    return (
      <img
        className={ui("message-image")}
        src={`data:${block.mimeType};base64,${block.data}`}
        alt={t("Pi 会话图片")}
      />
    );
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
