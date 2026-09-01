import { z } from "zod";
import {
  base64ByteLength,
  isValidBase64,
  maxPromptImageBytes,
  maxPromptImages,
  maxPromptImagesTotalBytes,
  supportedPromptImageMimeTypes,
  type PromptImage
} from "./prompt-images.js";
import type { SessionStatus, ThinkingLevel, UsageSummary } from "./common.js";
import { thinkingLevels } from "./common.js";

export interface SessionRecord extends UsageSummary {
  id: string;
  piSessionReference: string | null;
  cwd: string;
  displayName: string;
  status: SessionStatus;
  workerPid: number | null;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  systemPrompt: string | null;
  startedAt: string;
  settledAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  interruptionReason: string | null;
  lastEventSequence: number;
  createdBy: "web" | "cron" | "model";
  scheduleRunId: string | null;
  pinned?: boolean;
  pinnedAt?: string | null;
  deletedAt?: string | null;
  updatedAt: string;
}

export interface SessionListPage {
  sessions: SessionRecord[];
  nextCursor: string | null;
}

export interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
  [key: string]: unknown;
}

export interface PiMessage {
  role: string;
  content?: string | PiContentBlock[];
  summary?: string;
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
  stopReason?: string;
  timestamp?: string | number;
  [key: string]: unknown;
}

/**
 * Project only visible assistant text from Pi's streaming event shape.
 * Thinking and tool-call argument deltas are deliberately not conversation
 * text and must not leak into the live answer projection.
 */
export function extractPiTextDelta(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if ("assistantMessageEvent" in record) {
    const streamEvent =
      record.assistantMessageEvent &&
      typeof record.assistantMessageEvent === "object" &&
      !Array.isArray(record.assistantMessageEvent)
        ? (record.assistantMessageEvent as Record<string, unknown>)
        : {};
    return streamEvent.type === "text_delta" &&
      typeof streamEvent.delta === "string"
      ? streamEvent.delta
      : "";
  }
  if (record.type === "text_delta" && typeof record.delta === "string") {
    return record.delta;
  }
  if (
    typeof record.type === "string" &&
    record.type.endsWith("_delta")
  ) {
    return "";
  }
  if (typeof record.text === "string") return record.text;
  if (typeof record.contentDelta === "string") return record.contentDelta;
  if (typeof record.delta === "string") return record.delta;
  if (
    record.delta &&
    typeof record.delta === "object" &&
    !Array.isArray(record.delta) &&
    typeof (record.delta as Record<string, unknown>).text === "string"
  ) {
    return (record.delta as Record<string, unknown>).text as string;
  }
  return "";
}

export interface QueuedMessages {
  steering: string[];
  followUp: string[];
}

export interface SessionTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  role: string | null;
  summary: string;
  timestamp: string | null;
}

export interface SessionTreeSnapshot {
  nodes: SessionTreeNode[];
  leafId: string | null;
  activePathIds: string[];
  truncated: boolean;
}

export interface PendingExtensionInteraction {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message: string | null;
  options: string[];
  placeholder: string | null;
  prefill: string | null;
  timeoutMs: number | null;
  createdAt: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  messages: PiMessage[];
  /** Unmodified Pi `get_state` projection for an active worker. */
  state: Record<string, unknown> | null;
  /** Unmodified Pi `get_session_stats` projection when supported. */
  sessionStats: Record<string, unknown> | null;
  /** Bounded Sessiond-only transient activity for reconnect rendering. */
  recentToolEvents: RealtimeEvent[];
  liveText: string;
  queuedMessages: QueuedMessages;
  pendingInteractions: PendingExtensionInteraction[];
  tree: SessionTreeSnapshot | null;
  projectionEpoch: string;
  sequence: number;
  truncated: boolean;
  nextCursor: string | null;
}

export interface ProjectionCursor {
  projectionEpoch: string;
  sequence: number;
}

export type SessionSyncResult =
  | {
      mode: "incremental";
      projectionEpoch: string;
      events: RealtimeEvent[];
      sequence: number;
    }
  | {
      mode: "snapshot";
      snapshot: SessionSnapshot;
    };

export interface RealtimeEvent {
  sessionId: string;
  projectionEpoch: string;
  sequence: number;
  type: string;
  timestamp: string;
  payload: unknown;
}

const promptImageSchema = z.object({
  type: z.literal("image"),
  mimeType: z.enum(supportedPromptImageMimeTypes),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((maxPromptImageBytes * 4) / 3) + 4)
    .refine(isValidBase64, "Image data must be valid padded base64")
}).superRefine((image, context) => {
  if (base64ByteLength(image.data) > maxPromptImageBytes) {
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "Image exceeds the inline size limit"
    });
  }
});

const promptImagesSchema = z
  .array(promptImageSchema)
  .max(maxPromptImages)
  .default([])
  .superRefine((images, context) => {
    const total = images.reduce(
      (sum, image) => sum + base64ByteLength(image.data),
      0
    );
    if (total > maxPromptImagesTotalBytes) {
      context.addIssue({
        code: "custom",
        message: "Images exceed the total inline size limit"
      });
    }
  });

function requirePromptContent(
  value: { message?: string | undefined; images: PromptImage[] },
  context: z.RefinementCtx
) {
  if (!value.message?.trim() && value.images.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["message"],
      message: "Message or image is required"
    });
  }
}

const mutationIdSchema = z.string().uuid();

export const sessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().min(1).max(2048).optional()
});

export const createSessionSchema = z
  .object({
    mutationId: mutationIdSchema.optional(),
    cwd: z.string().min(1).max(4096),
    displayName: z.string().trim().min(1).max(160),
    prompt: z.string().max(200_000).optional(),
    images: promptImagesSchema,
    model: z.string().max(300).nullable().optional(),
    thinkingLevel: z.enum(thinkingLevels).nullable().optional(),
    systemPrompt: z.string().max(100_000).nullable().optional()
  })
  .superRefine((value, context) => {
    if (value.prompt !== undefined || value.images.length > 0) {
      requirePromptContent(
        { message: value.prompt, images: value.images },
        context
      );
    }
  });

export const sessionRenameSchema = z.object({
  displayName: z.string().trim().min(1).max(160)
});

export const promptSchema = z
  .object({
    mutationId: mutationIdSchema.optional(),
    message: z.string().max(200_000).default(""),
    images: promptImagesSchema,
    behavior: z.enum(["prompt", "steer", "follow_up"]).default("prompt")
  })
  .superRefine(requirePromptContent);

export const resumeSessionSchema = z
  .object({
    mutationId: mutationIdSchema.optional(),
    prompt: z.string().max(200_000).optional(),
    images: promptImagesSchema
  })
  .superRefine((value, context) => {
    if (value.prompt !== undefined || value.images.length > 0) {
      requirePromptContent(
        { message: value.prompt, images: value.images },
        context
      );
    }
  });

export const sessionFolderInputSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

export const sessionFolderAssignmentSchema = z.object({
  folderId: z.string().uuid().nullable()
});

export interface SessionFolder {
  id: string;
  name: string;
  createdAt: string;
}

export interface SessionFolderState {
  folders: SessionFolder[];
  assignments: Record<string, string>;
}

export const extensionUiResponseSchema = z
  .object({
    mutationId: mutationIdSchema.optional(),
    interactionId: z.string().min(1).max(200),
    cancelled: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    value: z.string().max(200_000).optional()
  })
  .strict()
  .superRefine((response, context) => {
    const outcomes = [
      response.cancelled === true,
      response.confirmed !== undefined,
      response.value !== undefined
    ].filter(Boolean).length;
    if (outcomes !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one extension UI response outcome is required"
      });
    }
  });
export type ExtensionUiResponse = z.infer<typeof extensionUiResponseSchema>;
