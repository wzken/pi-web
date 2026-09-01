import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { LfJsonlDecoder } from "@pi-web/ipc";
import type {
  PiMessage,
  SessionTreeNode,
  SessionTreeSnapshot,
  UsageSummary
} from "@pi-web/protocol";

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp?: string;
  message?: PiMessage;
  [key: string]: unknown;
}

interface CachedSession {
  signature: string;
  header: Record<string, unknown> | null;
  activeEntries: SessionEntry[];
  contextEntries: SessionEntry[];
  usage: UsageSummary;
  tree: SessionTreeSnapshot;
  estimatedBytes: number;
}

export interface SessionReadOptions {
  limit?: number;
  cursor?: string | null;
}

export interface SessionReadResult {
  header: Record<string, unknown> | null;
  entries: SessionEntry[];
  messages: PiMessage[];
  contextMessages: PiMessage[];
  truncated: boolean;
  nextCursor: string | null;
  usage: UsageSummary;
  tree: SessionTreeSnapshot;
}

const cache = new Map<string, CachedSession>();
const MAX_CACHE_ITEMS = 64;
const MAX_CACHE_ESTIMATED_BYTES = 128 * 1024 * 1024;
let cacheEstimatedBytes = 0;

export class PiSessionCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiSessionCursorError";
  }
}

export async function readPiSession(
  file: string,
  options: SessionReadOptions = {}
): Promise<SessionReadResult> {
  const info = await stat(file);
  const signature = `${info.size}:${info.mtimeMs}`;
  let cached = cache.get(file);
  if (!cached || cached.signature !== signature) {
    cached = await parseSession(file, signature, info.size);
    cacheSession(file, cached);
  } else {
    touchCachedSession(file, cached);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const total = cached.activeEntries.length;
  const end = resolveCursor(options.cursor, cached.activeEntries) ?? total;
  const start = Math.max(0, end - limit);
  const entries = cached.activeEntries.slice(start, end);
  const messages = entries.flatMap(projectDisplayMessages);

  return {
    header: cached.header,
    entries,
    messages,
    contextMessages: cached.contextEntries.flatMap(projectContextMessages),
    truncated: start > 0,
    nextCursor:
      start > 0 ? encodeCursor(cached.activeEntries[start]!.id) : null,
    usage: { ...cached.usage },
    tree: cached.tree
  };
}

async function parseSession(
  file: string,
  signature: string,
  sourceBytes: number
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
  if (errors.length > 0) throw errors[0];

  const header = validateHeader(records[0]);
  const tree = records.slice(1).map(validateEntry);
  const byId = new Map<string, SessionEntry>();
  for (const entry of tree) {
    if (byId.has(entry.id)) {
      throw new Error(`Duplicate Pi session entry id: ${entry.id}`);
    }
    byId.set(entry.id, entry);
  }
  for (const entry of tree) {
    if (entry.parentId !== null && !byId.has(entry.parentId)) {
      throw new Error(
        `Pi session entry ${entry.id} references missing parent ${entry.parentId}`
      );
    }
  }
  const leaf = tree.at(-1);
  const active: SessionEntry[] = [];
  const visited = new Set<string>();
  let current = leaf;
  while (current) {
    if (visited.has(current.id)) {
      throw new Error(`Cycle in Pi session tree at entry ${current.id}`);
    }
    visited.add(current.id);
    active.push(current);
    current =
      typeof current.parentId === "string"
        ? byId.get(current.parentId)
        : undefined;
  }
  active.reverse();
  const contextEntries = selectContextEntries(active);
  const projectedTree = projectTree(tree, active);
  return {
    signature,
    header,
    activeEntries: active,
    contextEntries,
    usage: aggregateUsage(tree),
    tree: projectedTree,
    estimatedBytes: estimateCachedSessionBytes(
      sourceBytes,
      active,
      contextEntries,
      projectedTree
    )
  };
}

function estimateCachedSessionBytes(
  sourceBytes: number,
  activeEntries: SessionEntry[],
  contextEntries: SessionEntry[],
  tree: SessionTreeSnapshot
): number {
  const normalizedSourceBytes =
    Number.isFinite(sourceBytes) && sourceBytes > 0 ? sourceBytes : 0;
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    normalizedSourceBytes * 2 +
      activeEntries.length * 16 +
      contextEntries.length * 16 +
      tree.nodes.length * 256
  );
}

function touchCachedSession(file: string, cached: CachedSession): void {
  cache.delete(file);
  cache.set(file, cached);
}

function cacheSession(file: string, cached: CachedSession): void {
  const previous = cache.get(file);
  if (previous) {
    cacheEstimatedBytes -= previous.estimatedBytes;
    cache.delete(file);
  }
  cache.set(file, cached);
  cacheEstimatedBytes += cached.estimatedBytes;

  while (
    cache.size > MAX_CACHE_ITEMS ||
    cacheEstimatedBytes > MAX_CACHE_ESTIMATED_BYTES
  ) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    if (evicted) cacheEstimatedBytes -= evicted.estimatedBytes;
  }
}

function validateHeader(
  value: SessionEntry | undefined
): Record<string, unknown> {
  if (!value || value.type !== "session") {
    throw new Error("Pi session header is missing");
  }
  if (value.version !== 3) {
    throw new Error(
      `Unsupported Pi session version: ${String(value.version ?? "unknown")}`
    );
  }
  return value as Record<string, unknown>;
}

function validateEntry(value: SessionEntry): SessionEntry {
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !("parentId" in value) ||
    (value.parentId !== null && typeof value.parentId !== "string")
  ) {
    throw new Error("Invalid Pi session tree entry");
  }
  if (
    value.type === "message" &&
    (!value.message || typeof value.message.role !== "string")
  ) {
    throw new Error(`Invalid Pi message entry: ${value.id}`);
  }
  return value;
}

function selectContextEntries(active: SessionEntry[]): SessionEntry[] {
  const compaction = active.findLast((entry) => entry.type === "compaction");
  if (!compaction) return active;
  const compactionIndex = active.indexOf(compaction);
  if (Array.isArray(compaction.retainedTail)) {
    return [compaction, ...active.slice(compactionIndex + 1)];
  }
  const selected = [compaction];
  const firstKeptEntryId =
    typeof compaction.firstKeptEntryId === "string"
      ? compaction.firstKeptEntryId
      : null;
  let keeping = false;
  for (let index = 0; index < compactionIndex; index += 1) {
    const entry = active[index]!;
    if (entry.id === firstKeptEntryId) keeping = true;
    if (keeping) selected.push(entry);
  }
  selected.push(...active.slice(compactionIndex + 1));
  return selected;
}

function projectDisplayMessages(entry: SessionEntry): PiMessage[] {
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return [
      {
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        ...(entry.timestamp === undefined
          ? {}
          : { timestamp: entry.timestamp })
      }
    ];
  }
  return projectEntryMessage(entry);
}

function projectContextMessages(entry: SessionEntry): PiMessage[] {
  if (entry.type !== "compaction") return projectEntryMessage(entry);
  if (typeof entry.summary !== "string") return [];
  const summary: PiMessage = {
    role: "compactionSummary",
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
    ...(entry.timestamp === undefined
      ? {}
      : { timestamp: entry.timestamp })
  };
  const retainedTail = Array.isArray(entry.retainedTail)
    ? entry.retainedTail.filter(isPiMessage)
    : [];
  return [summary, ...retainedTail];
}

function projectEntryMessage(entry: SessionEntry): PiMessage[] {
  if (entry.type === "message" && entry.message) return [entry.message];
  if (
    entry.type === "custom_message" &&
    typeof entry.customType === "string" &&
    (typeof entry.content === "string" || Array.isArray(entry.content))
  ) {
    return [
      {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display === true,
        details: entry.details,
        ...(entry.timestamp === undefined
          ? {}
          : { timestamp: entry.timestamp })
      }
    ];
  }
  if (
    entry.type === "branch_summary" &&
    typeof entry.summary === "string"
  ) {
    return [
      {
        role: "branchSummary",
        summary: entry.summary,
        fromId: entry.fromId,
        ...(entry.timestamp === undefined
          ? {}
          : { timestamp: entry.timestamp })
      }
    ];
  }
  if (entry.type === "compaction") return [];
  return [];
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
        : Array.isArray(message.content)
          ? message.content
              .flatMap((block) =>
                block.type === "text" && typeof block.text === "string"
                  ? [block.text]
                  : []
              )
              .join(" ")
          : "";
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
  function addUsage(value: unknown) {
    const usage = asRecord(value);
    inputTokens += firstNumber(usage.input, usage.inputTokens);
    outputTokens += firstNumber(usage.output, usage.outputTokens);
    cachedTokens += firstNumber(
      usage.cacheRead,
      usage.cache_read,
      usage.cachedTokens
    );
    const cost = asRecord(usage.cost);
    if (typeof cost.total === "number" && Number.isFinite(cost.total)) {
      reportedCost += cost.total;
      costReported = true;
    }
  }
  for (const entry of entries) {
    if (entry.type === "message" && entry.message) {
      const message = entry.message;
      if (Array.isArray(message.content)) {
        toolCalls += message.content.filter((block) =>
          ["toolCall", "tool_call"].includes(block.type)
        ).length;
      }
      addUsage(message.usage);
    } else if (
      entry.type === "compaction" ||
      entry.type === "branch_summary"
    ) {
      addUsage(entry.usage);
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

function firstNumber(...values: unknown[]): number {
  const value = values.find(
    (candidate) =>
      typeof candidate === "number" && Number.isFinite(candidate)
  );
  return typeof value === "number" ? value : 0;
}

function isPiMessage(value: unknown): value is PiMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).role === "string"
  );
}

function encodeCursor(entryId: string): string {
  return Buffer.from(JSON.stringify({ entryId }), "utf8").toString("base64url");
}

function resolveCursor(
  cursor: string | null | undefined,
  entries: SessionEntry[]
): number | null {
  if (!cursor) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new PiSessionCursorError("Invalid Pi session history cursor");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new PiSessionCursorError("Invalid Pi session history cursor");
  }
  const entryId = asRecord(value).entryId;
  if (typeof entryId !== "string" || !entryId) {
    throw new PiSessionCursorError("Invalid Pi session history cursor");
  }
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    throw new PiSessionCursorError(
      "Pi session history cursor no longer exists on the active branch"
    );
  }
  return index;
}

export function clearSessionCache(file?: string): void {
  if (file) {
    const cached = cache.get(file);
    if (!cached) return;
    cache.delete(file);
    cacheEstimatedBytes = Math.max(
      0,
      cacheEstimatedBytes - cached.estimatedBytes
    );
    return;
  }
  cache.clear();
  cacheEstimatedBytes = 0;
}
