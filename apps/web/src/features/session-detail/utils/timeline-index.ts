import type { PiMessage } from "@pi-web/protocol";

export function countTimelineMessageItems(messages: PiMessage[]): number {
  let count = 0;
  let insideToolGroup = false;
  for (const message of messages) {
    if (message.role === "toolResult") {
      if (!insideToolGroup) count += 1;
      insideToolGroup = true;
    } else {
      count += 1;
      insideToolGroup = false;
    }
  }
  return count;
}

export function prependedTimelineItemCount(
  current: PiMessage[],
  older: PiMessage[]
): number {
  if (older.length === 0) return 0;
  return Math.max(
    0,
    countTimelineMessageItems([...older, ...current]) -
      countTimelineMessageItems(current)
  );
}

export function reconcileTimelineFirstItemIndex(
  current: PiMessage[],
  next: PiMessage[],
  firstItemIndex: number,
  fallback: number
): number {
  if (current.length === 0 || next.length === 0) return fallback;
  const nextPositions = new Map<string, number>();
  next.forEach((message, index) => {
    const key = timelineMessageIdentity(message);
    if (!nextPositions.has(key)) nextPositions.set(key, index);
  });
  for (let currentIndex = 0; currentIndex < current.length; currentIndex += 1) {
    const currentMessage = current[currentIndex];
    if (!currentMessage) continue;
    const nextIndex = nextPositions.get(timelineMessageIdentity(currentMessage));
    if (nextIndex === undefined) continue;
    const adjusted =
      firstItemIndex +
      timelineItemOffset(current, currentIndex) -
      timelineItemOffset(next, nextIndex);
    return Math.max(1, adjusted);
  }
  return fallback;
}

function timelineItemOffset(messages: PiMessage[], messageIndex: number): number {
  let itemIndex = -1;
  let insideToolGroup = false;
  for (let index = 0; index <= messageIndex; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "toolResult") {
      if (!insideToolGroup) itemIndex += 1;
      insideToolGroup = true;
    } else {
      itemIndex += 1;
      insideToolGroup = false;
    }
  }
  return Math.max(0, itemIndex);
}

function timelineMessageIdentity(message: PiMessage): string {
  return JSON.stringify([
    message.role,
    message.timestamp ?? null,
    message.toolCallId ?? null,
    message.toolName ?? null,
    message.model ?? null,
    message.content
  ]);
}
