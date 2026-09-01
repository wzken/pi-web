import type { PiMessage, SessionStatus } from "@pi-web/protocol";
import { ArrowDown, Bot } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Button, useToast } from "../../../components";
import { t } from "../../../i18n";
import {
  extractLastUserPrompt,
  extractRetryablePrompt,
  type RetryablePrompt
} from "../../../session-messages";
import { ui } from "../../../ui";
import type { ActivityItem } from "../types";
import {
  MessageCard,
  ToolActivity,
  ToolResultGroup
} from "./MessageContent";
import {
  buildTimelineItems,
  deduplicateActivities,
  messageStorageKey,
  readHiddenMessages,
  writeHiddenMessages
} from "./timeline-items";

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

const FOLLOW_THRESHOLD = 24;

interface TimelineScrollPosition {
  anchorKey: string;
  anchorTop: number;
  scrollTop: number;
}

interface PagingAnchor {
  key: string;
  top: number;
  firstItemIndex: number;
  requestId: number;
}

const sessionScrollPositions = new Map<string, TimelineScrollPosition>();

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
  const scroller = useRef<HTMLDivElement | null>(null);
  const flow = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const observedScrollTop = useRef(0);
  const previousFirstItemIndex = useRef(firstItemIndex);
  const previousScrollHeight = useRef(0);
  const initializedSession = useRef<string | null>(null);
  const pagingAnchor = useRef<PagingAnchor | null>(null);
  const loadRequestId = useRef(0);
  const followLatest = useRef<(() => void) | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hiddenMessageKeys, setHiddenMessageKeys] = useState<Set<string>>(
    () => readHiddenMessages(sessionId)
  );
  useEffect(() => setHiddenMessageKeys(readHiddenMessages(sessionId)), [sessionId]);
  const items = useMemo(
    () =>
      buildTimelineItems(
        messages,
        deduplicateActivities(messages, activities),
        liveText,
        running,
        hiddenMessageKeys
      ),
    [activities, hiddenMessageKeys, liveText, messages, running]
  );

  const toBottom = useCallback((element: HTMLElement) => {
    pagingAnchor.current = null;
    element.scrollTop = element.scrollHeight;
    observedScrollTop.current = element.scrollTop;
    previousScrollHeight.current = element.scrollHeight;
    stickToBottom.current = true;
    setAtBottom(true);
    sessionScrollPositions.delete(sessionId);
  }, [sessionId]);

  useLayoutEffect(() => {
    const element = scroller.current;
    const list = flow.current;
    if (!element || !list) return;

    if (initializedSession.current !== sessionId) {
      initializedSession.current = sessionId;
      pagingAnchor.current = null;
      previousFirstItemIndex.current = firstItemIndex;
      const saved = sessionScrollPositions.get(sessionId) ?? null;
      if (saved === null) {
        toBottom(element);
      } else {
        element.scrollTop = saved.scrollTop;
        const row = anchorElement(list, saved.anchorKey);
        if (row) {
          element.scrollTop += flowTop(row, element) - saved.anchorTop;
        }
        observedScrollTop.current = element.scrollTop;
        previousScrollHeight.current = element.scrollHeight;
        const isAtBottom = distanceFromBottom(element) <= FOLLOW_THRESHOLD + 1;
        stickToBottom.current = isAtBottom;
        setAtBottom(isAtBottom);
        saveSessionScrollPosition(
          sessionId,
          isAtBottom ? null : readScrollPosition(list, element)
        );
      }
      return;
    }

    const currentScrollHeight = element.scrollHeight;
    const prepended = firstItemIndex < previousFirstItemIndex.current;
    const anchor = pagingAnchor.current;
    if (prepended) {
      pagingAnchor.current = null;
      const relevantAnchor =
        anchor && firstItemIndex < anchor.firstItemIndex ? anchor : null;
      const row = relevantAnchor
        ? anchorElement(list, relevantAnchor.key)
        : null;
      if (row && relevantAnchor) {
        element.scrollTop += flowTop(row, element) - relevantAnchor.top;
      } else if (!stickToBottom.current) {
        element.scrollTop += currentScrollHeight - previousScrollHeight.current;
      } else {
        toBottom(element);
      }
      observedScrollTop.current = element.scrollTop;
    } else if (stickToBottom.current) {
      toBottom(element);
    }

    previousFirstItemIndex.current = firstItemIndex;
    previousScrollHeight.current = element.scrollHeight;
    const isAtBottom = stickToBottom.current
      ? true
      : distanceFromBottom(element) <= FOLLOW_THRESHOLD + 1;
    setAtBottom(isAtBottom);
    saveSessionScrollPosition(
      sessionId,
      isAtBottom ? null : readScrollPosition(list, element)
    );
  }, [firstItemIndex, items, sessionId, toBottom]);

  followLatest.current = () => {
    const element = scroller.current;
    if (element && stickToBottom.current) toBottom(element);
  };

  useEffect(() => {
    const list = flow.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => followLatest.current?.());
    observer.observe(list);
    return () => observer.disconnect();
  }, [sessionId]);

  function handleScroll(element: HTMLElement) {
    const list = flow.current;
    if (!list) return;
    const floor = Math.max(0, element.scrollHeight - element.clientHeight);
    const movedByReader =
      Math.abs(
        element.scrollTop - Math.min(observedScrollTop.current, floor)
      ) > 0.5;
    const isAtBottom = movedByReader
      ? floor - element.scrollTop <= FOLLOW_THRESHOLD + 1
      : stickToBottom.current;

    if (!movedByReader && isAtBottom) {
      toBottom(element);
      return;
    }

    stickToBottom.current = isAtBottom;
    setAtBottom(isAtBottom);
    const position = isAtBottom ? null : readScrollPosition(list, element);
    const pending = pagingAnchor.current;
    if (isAtBottom) {
      pagingAnchor.current = null;
    } else if (pending && position) {
      pagingAnchor.current = {
        key: position.anchorKey,
        top: position.anchorTop,
        firstItemIndex: pending.firstItemIndex,
        requestId: pending.requestId
      };
    }
    saveSessionScrollPosition(sessionId, position);
    observedScrollTop.current = element.scrollTop;
    previousScrollHeight.current = element.scrollHeight;
  }

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
    const element = scroller.current;
    const list = flow.current;
    const requestId = loadRequestId.current + 1;
    loadRequestId.current = requestId;
    if (element && list) {
      const row = visibleAnchor(list, element);
      if (row?.dataset.messageAnchorKey) {
        pagingAnchor.current = {
          key: row.dataset.messageAnchorKey,
          top: flowTop(row, element),
          firstItemIndex,
          requestId
        };
        stickToBottom.current = false;
        setAtBottom(false);
      }
    }
    setLoadingEarlier(true);
    try {
      await onLoadEarlier();
    } finally {
      setLoadingEarlier(false);
      window.requestAnimationFrame(() => {
        if (pagingAnchor.current?.requestId === requestId) {
          pagingAnchor.current = null;
        }
      });
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
      <div
        ref={scroller}
        className={ui("message-scroller")}
        data-conversation-scroller="true"
        onScroll={(event) => handleScroll(event.currentTarget)}
      >
        <div ref={flow} data-message-flow="true">
          {items.length === 0 ? (
            <div className={ui("conversation-empty")}>
              <div className={ui("empty-orbit")}>
                <Bot size={24} />
              </div>
              <h2>{t("会话已就绪")}</h2>
              <p>{t("在下方输入任务，Pi 会在这个工作目录中开始行动。")}</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                className={ui("message-list-item")}
                data-message-anchor-key={item.key}
                key={item.key}
              >
                {item.kind === "message" ? (
                  <MessageCard
                    message={item.message}
                    retryPrompt={
                      item.messageIndex === messages.length - 1
                        ? item.message.role === "assistant"
                          ? extractLastUserPrompt(messages)
                          : extractRetryablePrompt(messages, status)
                        : null
                    }
                    replayBusy={replayBusy}
                    onReplay={() => {
                      const retryPrompt =
                        item.messageIndex === messages.length - 1
                          ? item.message.role === "assistant"
                            ? extractLastUserPrompt(messages)
                            : extractRetryablePrompt(messages, status)
                          : null;
                      if (retryPrompt) onReplayPrompt(retryPrompt, status);
                    }}
                    onDelete={() => hideMessage(item.message)}
                    onNotice={(message, tone) => toast.push(message, tone)}
                  />
                ) : item.kind === "tool-group" ? (
                  <ToolResultGroup messages={item.messages} />
                ) : item.kind === "activity" ? (
                  <ToolActivity activity={item.activity} />
                ) : (
                  <article className={ui("message assistant live-message")}>
                    <div className={ui("message-avatar")}>
                      <Bot size={16} />
                    </div>
                    <div className={ui("message-body")}>
                      <div className={ui("message-label")}>{t("Pi 正在回复")}</div>
                      <div className={ui("live-stream-text")}>{item.text}</div>
                      <span className={ui("typing-cursor")} />
                    </div>
                  </article>
                )}
              </div>
            ))
          )}
          <div className={ui("message-footer-space")} />
        </div>
      </div>
      {!atBottom && (
        <button
          className={ui("scroll-bottom")}
          onClick={() => {
            const element = scroller.current;
            if (element) toBottom(element);
          }}
        >
          <ArrowDown size={15} />
          {t("回到底部")}
        </button>
      )}
    </div>
  );
}

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(
    0,
    element.scrollHeight - element.clientHeight - element.scrollTop
  );
}

function saveSessionScrollPosition(
  sessionId: string,
  position: TimelineScrollPosition | null
): void {
  if (position === null) {
    sessionScrollPositions.delete(sessionId);
  } else {
    sessionScrollPositions.set(sessionId, position);
  }
}

function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>(
    "[data-message-anchor-key]"
  )) {
    if (row.dataset.messageAnchorKey === key) return row;
  }
  return null;
}

function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return (
    row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
  );
}

function visibleAnchor(
  list: HTMLElement,
  scrollport: HTMLElement
): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect();
  const content = list.getBoundingClientRect();
  const left = Math.max(viewport.left, content.left);
  const right = Math.min(viewport.right, content.right);
  if (
    typeof document.elementsFromPoint === "function" &&
    right > left &&
    viewport.bottom > viewport.top
  ) {
    const x = left + (right - left) / 2;
    const height = viewport.bottom - viewport.top;
    const offsets = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)];
    for (const offset of offsets) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row =
          element instanceof HTMLElement
            ? element.closest<HTMLElement>("[data-message-anchor-key]")
            : null;
        if (row && list.contains(row)) return row;
      }
    }
  }

  const rows = [
    ...list.querySelectorAll<HTMLElement>("[data-message-anchor-key]")
  ];
  return (
    rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    }) ??
    rows[0] ??
    null
  );
}

function readScrollPosition(
  list: HTMLElement,
  scrollport: HTMLElement
): TimelineScrollPosition | null {
  const row = visibleAnchor(list, scrollport);
  const anchorKey = row?.dataset.messageAnchorKey;
  if (!row || !anchorKey) return null;
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop
  };
}
