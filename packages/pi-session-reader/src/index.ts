import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { LfJsonlDecoder } from "@pi-web/pi-rpc";
import type {
  PiMessage,
  SessionTreeNode,
  SessionTreeSnapshot,
  UsageSummary
} from "@pi-web/protocol";

interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: PiMessage;
  [key: string]: unknown;
}

interface CachedSession {
  signature: string;
  header: Record<string, unknown> | null;
  activeEntries: SessionEntry[];
  tree: SessionTreeSnapshot;
}

export interface SessionReadOptions {
  limit?: number;
  cursor?: string | null;
}

export interface SessionReadResult {
  header: Record<string, unknown> | null;
  entries: SessionEntry[];
  messages: PiMessage[];
  truncated: boolean;
  nextCursor: string | null;
  usage: UsageSummary;
  tree: SessionTreeSnapshot;
}

const cache = new Map<string, CachedSession>();
const MAX_CACHE_ITEMS = 64;

export async function readPiSession(
  file: string,
  options: SessionReadOptions = {}
): Promise<SessionReadResult> {
  const info = await stat(file);
  const signature = `${info.size}:${info.mtimeMs}`;
  let cached = cache.get(file);
  if (!cached || cached.signature !== signature) {
    cached = await parseSession(file, signature);
    cache.set(file, cached);
    while (cache.size > MAX_CACHE_ITEMS) {
      const oldest = cache.keys().next().value as string | undefined;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }

  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const total = cached.activeEntries.length;
  const end = decodeCursor(options.cursor) ?? total;
  const safeEnd = Math.max(0, Math.min(end, total));
  const start = Math.max(0, safeEnd - limit);
  const entries = cached.activeEntries.slice(start, safeEnd);
  const messages = entries
    .filter((entry): entry is SessionEntry & { message: PiMessage } =>
      entry.type === "message" && !!entry.message
    )
    .map((entry) => entry.message);

  return {
    header: cached.header,
    entries,
    messages,
    truncated: start > 0,
    nextCursor: start > 0 ? encodeCursor(start) : null,
    usage: aggregateUsage(cached.activeEntries),
    tree: cached.tree
  };
}

async function parseSession(
  file: string,
  signature: string
): Promise<CachedSession> {
  const records: SessionEntry[] = [];
  const errors: Error[] = [];
  const stream = createReadStream(file);
  const decoder = new LfJsonlDecoder({
    maxLineBytes: 64 * 1024 * 1024,
    onValue: (value) => {
      if (value && typeof value === "object") records.push(value as SessionEntry);
    },
    onError: (error) => errors.push(error)
  });
  stream.on("data", (chunk) =>
    decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  );
  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.once("end", () => {
      decoder.end();
      resolve();
    });
  });
  if (errors.length > 0 && records.length === 0) throw errors[0];

  const headerIndex = records.findIndex((entry) => entry.type === "session");
  const header =
    headerIndex >= 0 ? (records[headerIndex] as Record<string, unknown>) : null;
  const tree = records.filter(
    (entry) => typeof entry.id === "string" && "parentId" in entry
  );
  const byId = new Map(tree.map((entry) => [entry.id as string, entry]));
  const leaf = tree.at(-1);
  const active: SessionEntry[] = [];
  const visited = new Set<string>();
  let current = leaf;
  while (current?.id && !visited.has(current.id)) {
    visited.add(current.id);
    active.push(current);
    current =
      typeof current.parentId === "string"
        ? byId.get(current.parentId)
        : undefined;
  }
  active.reverse();
  return {
    signature,
    header,
    activeEntries: active,
    tree: projectTree(tree, active)
  };
}

const MAX_TREE_NODES = 2_000;

function projectTree(
  entries: SessionEntry[],
  activeEntries: SessionEntry[]
): SessionTreeSnapshot {
  const selectedIds = new Set(
    activeEntries
      .slice(-MAX_TREE_NODES)
      .flatMap((entry) => (entry.id ? [entry.id] : []))
  );
  for (
    let index = entries.length - 1;
    index >= 0 && selectedIds.size < MAX_TREE_NODES;
    index -= 1
  ) {
    const id = entries[index]?.id;
    if (id) selectedIds.add(id);
  }
  const selected = entries.filter(
    (entry): entry is SessionEntry & { id: string } =>
      typeof entry.id === "string" && selectedIds.has(entry.id)
  );
  const nodes: SessionTreeNode[] = selected.map((entry) => ({
    id: entry.id,
    parentId: typeof entry.parentId === "string" ? entry.parentId : null,
    type: entry.type,
    role:
      entry.message && typeof entry.message.role === "string"
        ? entry.message.role
        : null,
    summary: summarizeEntry(entry),
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null
  }));
  const leafId = activeEntries.at(-1)?.id ?? null;
  return {
    nodes,
    leafId,
    activePathIds: activeEntries.flatMap((entry) =>
      typeof entry.id === "string" && selectedIds.has(entry.id)
        ? [entry.id]
        : []
    ),
    truncated: selected.length < entries.length
  };
}

function summarizeEntry(entry: SessionEntry): string {
  if (entry.message) {
    const message = entry.message;
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content
            .flatMap((block) =>
              block.type === "text" && typeof block.text === "string"
                ? [block.text]
                : []
            )
            .join(" ");
    return compactSummary(content || `${message.role} message`);
  }
  const record = entry as Record<string, unknown>;
  for (const key of ["summary", "label", "name", "customType"]) {
    if (typeof record[key] === "string") {
      return compactSummary(record[key]);
    }
  }
  return entry.type.replaceAll("_", " ");
}

function compactSummary(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 159)}…` : compact;
}

function aggregateUsage(entries: SessionEntry[]): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let reportedCost = 0;
  let costReported = false;
  let toolCalls = 0;
  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (Array.isArray(message.content)) {
      toolCalls += message.content.filter((block) =>
        ["toolCall", "tool_call"].includes(block.type)
      ).length;
    }
    const usage = asRecord(message.usage);
    inputTokens += numberValue(usage.input) + numberValue(usage.inputTokens);
    outputTokens += numberValue(usage.output) + numberValue(usage.outputTokens);
    cachedTokens +=
      numberValue(usage.cacheRead) +
      numberValue(usage.cache_read) +
      numberValue(usage.cachedTokens);
    const cost = asRecord(usage.cost);
    if (typeof cost.total === "number") {
      reportedCost += cost.total;
      costReported = true;
    }
  }
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reportedCost: costReported ? reportedCost : null,
    estimatedCost: null,
    costStatus: costReported ? "reported" : "unknown",
    toolCalls
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function clearSessionCache(file?: string): void {
  if (file) cache.delete(file);
  else cache.clear();
}
