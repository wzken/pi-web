import type { NotificationRecord } from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import { mergeNotification } from "./notification-context";

function notification(
  id: string,
  patch: Partial<NotificationRecord> = {}
): NotificationRecord {
  return {
    id,
    kind: "session_settled",
    severity: "success",
    title: "done",
    body: "session",
    href: `/sessions/${id}`,
    sessionId: id,
    jobId: null,
    runId: null,
    requiresAction: false,
    readAt: null,
    resolvedAt: null,
    dismissedAt: null,
    createdAt: `2026-08-12T00:00:0${id}.000Z`,
    updatedAt: `2026-08-12T00:00:0${id}.000Z`,
    ...patch
  };
}

describe("notification inbox projection", () => {
  it("replaces updates and removes dismissed notifications", () => {
    const first = {
      notifications: [notification("1")],
      unreadCount: 1,
      attentionCount: 0
    };
    const read = mergeNotification(
      first,
      notification("1", { readAt: "2026-08-12T00:02:00.000Z" })
    );
    expect(read).toMatchObject({ unreadCount: 0 });
    expect(read.notifications).toHaveLength(1);

    const dismissed = mergeNotification(
      read,
      notification("1", { dismissedAt: "2026-08-12T00:03:00.000Z" })
    );
    expect(dismissed.notifications).toEqual([]);
  });
});
