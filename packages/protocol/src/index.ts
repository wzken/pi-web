import { z } from "zod";
import {
  base64ByteLength,
  maxPromptImageBytes,
  maxPromptImages,
  maxPromptImagesTotalBytes,
  supportedPromptImageMimeTypes,
  type PromptImage
} from "./prompt-images.js";
import { themeTokenNames } from "./theme-tokens.js";

export {
  base64ByteLength,
  isSupportedPromptImageMimeType,
  maxPromptImageBytes,
  maxPromptImages,
  maxPromptImagesTotalBytes,
  maxPromptRequestBytes,
  supportedPromptImageMimeTypes
} from "./prompt-images.js";
export type {
  PromptImage,
  PromptImageMimeType
} from "./prompt-images.js";
export { themeTokenNames } from "./theme-tokens.js";
export type { ThemeTokenName } from "./theme-tokens.js";

export const sessionStatuses = [
  "starting",
  "running",
  "waiting",
  "stopping",
  "failed",
  "interrupted",
  "closed"
] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const runStatuses = [
  "scheduled",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "skipped_overlap",
  "cancelled",
  "missed"
] as const;
export type RunStatus = (typeof runStatuses)[number];

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];

export const scheduleActions = [
  "create",
  "list",
  "get",
  "update",
  "enable",
  "disable",
  "delete",
  "run_now"
] as const;
export type ScheduleAction = (typeof scheduleActions)[number];

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reportedCost: number | null;
  estimatedCost: number | null;
  costStatus: "reported" | "estimated" | "unknown";
  toolCalls: number;
}

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
  updatedAt: string;
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
  tree: SessionTreeSnapshot | null;
  sequence: number;
  truncated: boolean;
  nextCursor: string | null;
}

export interface RealtimeEvent {
  sessionId: string;
  sequence: number;
  type: string;
  timestamp: string;
  payload: unknown;
}

export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  cwd: string;
  prompt: string;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  timeoutSeconds: number;
  overlapPolicy: "skip";
  createdBy: "web" | "model" | "import";
  createdFromSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface ScheduledRun {
  id: string;
  jobId: string;
  sessionId: string | null;
  scheduledFor: string;
  triggerType: "cron" | "manual" | "model_run_now";
  status: RunStatus;
  startedAt: string | null;
  endedAt: string | null;
  errorSummary: string | null;
  inputTokens: number;
  outputTokens: number;
  reportedCost: number | null;
  estimatedCost: number | null;
}

export interface DashboardSummary {
  runningSessions: number;
  sessionsToday: number;
  cronRunsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  reportedCostToday: number;
  recentSessions: SessionRecord[];
  recentRuns: ScheduledRun[];
  recentProblems: SessionRecord[];
}

export interface PiModelSummary {
  provider: string;
  id: string;
  label: string;
}

export interface PiStatus {
  available: boolean;
  executable: string;
  version: string | null;
  models: PiModelSummary[];
  packages: string[];
  errors: string[];
}

export const authRotateSchema = z
  .object({
    hash: z
      .object({
        algorithm: z.literal("scrypt"),
        salt: z.string().min(1).max(512),
        hash: z.string().min(1).max(512)
      })
      .strict(),
    auditType: z.enum(["access_key.reset", "access_key.set"]),
    actor: z.enum(["web", "cli"])
  })
  .strict();
export type AuthRotateInput = z.infer<typeof authRotateSchema>;

export interface AuthRotateResult {
  updated: true;
}

export interface PiDoctorProbe {
  available: boolean;
  version: string | null;
  rpcStartable: boolean;
  packageCommands: boolean;
  errors: string[];
}

export interface SessiondDoctorResult {
  database: boolean;
  socket: string;
  scheduler: boolean;
  activeWorkers: number;
  pi: PiDoctorProbe;
}

export interface InternalRequest {
  kind: "request";
  id: string;
  method: string;
  params?: unknown;
  auth?: {
    role: "server";
    token: string;
  };
}

export interface InternalResponse {
  kind: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  };
}

export interface InternalEvent {
  kind: "event";
  event: RealtimeEvent;
}

export type InternalMessage = InternalRequest | InternalResponse | InternalEvent;

const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
const promptImageSchema = z.object({
  type: z.literal("image"),
  mimeType: z.enum(supportedPromptImageMimeTypes),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((maxPromptImageBytes * 4) / 3) + 4)
    .regex(base64Pattern)
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

export const jobInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  enabled: z.boolean().default(true),
  cronExpression: z.string().trim().min(1).max(100),
  timezone: z.string().trim().min(1).max(100),
  cwd: z.string().min(1).max(4096),
  prompt: z.string().trim().min(1).max(200_000),
  model: z.string().max(300).nullable().default(null),
  thinkingLevel: z.enum(thinkingLevels).nullable().default(null),
  timeoutSeconds: z.number().int().min(1).max(86_400).default(3600),
  overlapPolicy: z.literal("skip").default("skip")
});
export type JobInput = z.infer<typeof jobInputSchema>;

export const settingsUpdateSchema = z.object({
  allowedRoots: z.array(z.string().min(1).max(4096)).min(1).max(32).optional(),
  allowAnyDirectory: z.boolean().optional(),
  defaultTimezone: z.string().min(1).max(100).optional(),
  defaultCronTimeoutSeconds: z.number().int().min(1).max(86_400).optional(),
  minimumCronIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  modelSchedulePolicy: z.enum(["allow", "create_disabled", "deny"]).optional(),
  piExecutable: z.string().min(1).max(4096).optional(),
  cookieSecure: z.enum(["auto", "always", "never"]).optional(),
  defaultModel: z.string().max(300).nullable().optional(),
  defaultThinkingLevel: z.enum(thinkingLevels).nullable().optional(),
  defaultSystemPrompt: z.string().max(100_000).nullable().optional()
});

const themeTokensSchema = z
  .record(z.string(), z.string().trim().min(1).max(300))
  .superRefine((tokens, context) => {
    const allowed = new Set<string>(themeTokenNames);
    for (const key of Object.keys(tokens)) {
      if (!allowed.has(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `Unsupported theme token: ${key}`
        });
      }
    }
  });

export const themeBackgroundSchema = z.object({
  image: z.string().trim().min(1).max(500),
  fit: z.enum(["cover", "contain", "tile"]).default("cover"),
  position: z.string().trim().min(1).max(120).default("center"),
  overlay: z.number().min(0).max(0.9).default(0.18),
  blur: z.number().min(0).max(24).default(0)
});
export type ThemeBackground = z.infer<typeof themeBackgroundSchema>;

const themeManifestMetadata = {
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(40),
  description: z.string().trim().max(240).default(""),
  author: z.string().trim().max(100).default(""),
  css: z.string().trim().min(1).max(500).optional(),
  preview: z.string().trim().min(1).max(500).optional(),
  background: themeBackgroundSchema.optional()
};

const singleSchemeThemeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  ...themeManifestMetadata,
  colorScheme: z.enum(["light", "dark"]).default("light"),
  tokens: themeTokensSchema.default({})
});

const dualSchemeThemeManifestSchema = z.object({
  schemaVersion: z.literal(2),
  ...themeManifestMetadata,
  schemes: z.object({
    light: z.object({ tokens: themeTokensSchema.default({}) }),
    dark: z.object({ tokens: themeTokensSchema.default({}) })
  })
});

export const themeManifestSchema = z.discriminatedUnion("schemaVersion", [
  singleSchemeThemeManifestSchema,
  dualSchemeThemeManifestSchema
]);
export type ThemeManifest = z.infer<typeof themeManifestSchema>;

export const themePreferencesSchema = z.object({
  themeId: z.string().trim().min(1).max(64),
  colorMode: z.enum(["system", "light", "dark"]).default("system"),
  background: z
    .object({
      kind: z.enum(["none", "theme", "upload", "url"]).default("none"),
      url: z.string().trim().max(2048).default(""),
      fit: z.enum(["cover", "contain", "tile"]).default("cover"),
      position: z.string().trim().min(1).max(120).default("center"),
      overlay: z.number().min(0).max(0.9).default(0.18),
      blur: z.number().min(0).max(24).default(0)
    })
    .default({
      kind: "none",
      url: "",
      fit: "cover",
      position: "center",
      overlay: 0.18,
      blur: 0
    })
});
export type ThemePreferences = z.infer<typeof themePreferencesSchema>;

export type InstalledTheme = ThemeManifest & {
  source: "built-in" | "uploaded";
  cssUrl?: string;
  previewUrl?: string;
  backgroundUrl?: string;
  updatedAt: string;
};

export interface ThemeCatalog {
  themes: InstalledTheme[];
  preferences: ThemePreferences;
  userBackgroundUrl?: string;
}

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

export const browserSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    sessionId: z.string().uuid(),
    afterSequence: z.number().int().min(0).default(0)
  }),
  z.object({
    type: z.literal("unsubscribe"),
    sessionId: z.string().uuid()
  }),
  z.object({ type: z.literal("ping") })
]);

export function isInternalMessage(value: unknown): value is InternalMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "request" ||
    record.kind === "response" ||
    record.kind === "event"
  );
}
