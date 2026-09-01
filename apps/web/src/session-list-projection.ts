import type { SessionRecord, SessionStatus } from "@pi-web/protocol";

export const sessionViewFilters = [
  "all",
  "active",
  "attention",
  "pinned",
  "closed"
] as const;
export type SessionViewFilter = (typeof sessionViewFilters)[number];

export const sessionSortOrders = [
  "recent",
  "oldest",
  "tokens",
  "tools"
] as const;
export type SessionSortOrder = (typeof sessionSortOrders)[number];

const activeStatuses = new Set<SessionStatus>([
  "starting",
  "running",
  "waiting",
  "stopping"
]);
const attentionStatuses = new Set<SessionStatus>(["failed", "interrupted"]);

export function parseSessionViewFilter(value: string | null): SessionViewFilter {
  return sessionViewFilters.includes(value as SessionViewFilter)
    ? (value as SessionViewFilter)
    : "all";
}

export function parseSessionSortOrder(value: string | null): SessionSortOrder {
  return sessionSortOrders.includes(value as SessionSortOrder)
    ? (value as SessionSortOrder)
    : "recent";
}

export function projectSessions(
  sessions: SessionRecord[],
  options: {
    query: string;
    filter: SessionViewFilter;
    sort: SessionSortOrder;
  }
): SessionRecord[] {
  const needle = options.query.normalize("NFKC").toLocaleLowerCase().trim();
  const projected = sessions.filter((session) => {
    if (
      needle &&
      !`${session.displayName} ${session.cwd} ${session.model ?? ""}`
        .normalize("NFKC")
        .toLocaleLowerCase()
        .includes(needle)
    ) {
      return false;
    }
    if (options.filter === "active") return activeStatuses.has(session.status);
    if (options.filter === "attention") {
      return attentionStatuses.has(session.status);
    }
    if (options.filter === "pinned") return session.pinned === true;
    if (options.filter === "closed") return session.status === "closed";
    return true;
  });

  return projected.toSorted((left, right) => {
    const pinned = Number(right.pinned === true) - Number(left.pinned === true);
    if (pinned !== 0) return pinned;
    if (options.sort === "oldest") {
      return compareDate(left.updatedAt, right.updatedAt);
    }
    if (options.sort === "tokens") {
      return totalTokens(right) - totalTokens(left) ||
        compareDate(right.updatedAt, left.updatedAt);
    }
    if (options.sort === "tools") {
      return right.toolCalls - left.toolCalls ||
        compareDate(right.updatedAt, left.updatedAt);
    }
    return compareDate(right.updatedAt, left.updatedAt);
  });
}

function totalTokens(session: SessionRecord): number {
  return session.inputTokens + session.outputTokens;
}

function compareDate(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}
