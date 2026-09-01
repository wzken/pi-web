import type { z } from "zod";
import type { AuthRotateInput, AuthRotateResult } from "./auth.js";
import type { ThinkingLevel } from "./common.js";
import type { DashboardSummary } from "./dashboard.js";
import type {
  NotificationRecord,
  NotificationSummary,
  PushDeliveryTarget,
  PushSubscriptionRecord,
  PushVapidKeys
} from "./notifications.js";
import type {
  PiStatus,
  PiUpdateInfo,
  SessiondDoctorResult
} from "./pi.js";
import type {
  ScheduledJob,
  ScheduledRun,
  jobInputSchema
} from "./schedules.js";
import type {
  SessionFolderState,
  SessionListPage,
  SessionRecord,
  SessionSnapshot,
  SessionSyncResult,
  createSessionSchema,
  extensionUiResponseSchema,
  promptSchema,
  resumeSessionSchema,
  sessionFolderAssignmentSchema,
  sessionFolderInputSchema,
  sessionListQuerySchema,
  sessionRenameSchema
} from "./sessions.js";
import type { settingsUpdateSchema } from "./settings.js";

export interface PiWebSettings {
  host: string;
  port: number;
  allowedRoots: string[];
  allowAnyDirectory: boolean;
  defaultTimezone: string;
  defaultCronTimeoutSeconds: number;
  minimumCronIntervalMinutes: number;
  modelSchedulePolicy: "allow" | "create_disabled" | "deny";
  piExecutable: string;
  trustedProxy: boolean;
  cookieSecure: "auto" | "always" | "never";
  defaultModel: string | null;
  defaultThinkingLevel: ThinkingLevel | null;
  defaultSystemPrompt: string | null;
  maxScheduledJobs: number;
  maxConcurrentWorkers: number;
  eventBufferSize: number;
}

export interface AccessKeyHash {
  algorithm: "scrypt";
  salt: string;
  hash: string;
}

export interface RecentDirectory {
  path: string;
  alias: string | null;
  favorite: boolean;
  lastUsedAt: string;
}

export interface DirectoryBrowseResult {
  root: string;
  path: string;
  absolutePath: string;
  entries: Array<{
    name: string;
    path: string;
    directory: true;
  }>;
}

export type ScheduledJobView = ScheduledJob & { human: string };
interface IpcMethodContract<Params, Result> {
  readonly role: "server" | "extension" | "handshake";
  readonly params: Params;
  readonly result: Result;
}

function ipcMethod<Params, Result>(
  role: IpcMethodContract<Params, Result>["role"] = "server"
): IpcMethodContract<Params, Result> {
  return { role } as IpcMethodContract<Params, Result>;
}

export const ipcContract = {
  "protocol.handshake": ipcMethod<{ role: "server" | "extension" }, {
      protocolVersion: number;
      role: "server" | "extension";
      capabilities: string[];
    }>("handshake"),
  health: ipcMethod<undefined, { ok: true; pid: number; now: string; activeWorkers: number }>(),
  "service.prepare_change": ipcMethod<{ action: "stop" | "restart" | "uninstall"; force: boolean }, { activeWorkers: number; forced: boolean }>(),
  "service.cancel_change": ipcMethod<undefined, { cancelled: true }>(),
  dashboard: ipcMethod<undefined, DashboardSummary>(),
  "sessions.list": ipcMethod<z.input<typeof sessionListQuerySchema> | undefined, SessionListPage>(),
  "sessions.get": ipcMethod<{ id: string }, SessionRecord>(),
  "sessions.rename": ipcMethod<{ id: string } & z.input<typeof sessionRenameSchema>, SessionRecord>(),
  "sessions.pin": ipcMethod<{ id: string; pinned: boolean }, SessionRecord>(),
  "sessions.delete": ipcMethod<{ id: string }, { deleted: true }>(),
  "sessions.create": ipcMethod<z.input<typeof createSessionSchema>, SessionRecord>(),
  "sessions.fork": ipcMethod<{ id: string }, SessionRecord>(),
  "sessions.resume": ipcMethod<{ id: string } & z.input<typeof resumeSessionSchema>, SessionRecord>(),
  "sessions.prompt": ipcMethod<{ id: string } & z.input<typeof promptSchema>, { accepted: true }>(),
  "sessions.abort": ipcMethod<{ id: string }, { accepted: true }>(),
  "sessions.close": ipcMethod<{ id: string }, { closed: true }>(),
  "sessions.model": ipcMethod<{ id: string; model: string }, { updated: true }>(),
  "sessions.thinking": ipcMethod<{ id: string; thinkingLevel: ThinkingLevel }, { updated: true }>(),
  "sessions.extension_ui_response": ipcMethod<{ id: string } & z.input<typeof extensionUiResponseSchema>, { accepted: true }>(),
  "sessions.snapshot": ipcMethod<{ id: string; cursor?: string | null }, SessionSnapshot>(),
  "sessions.sync": ipcMethod<{
      id: string;
      projectionEpoch?: string | null;
      afterSequence?: number;
    }, SessionSyncResult>(),
  "session_folders.get": ipcMethod<undefined, SessionFolderState>(),
  "session_folders.create": ipcMethod<z.input<typeof sessionFolderInputSchema>, SessionFolderState>(),
  "session_folders.rename": ipcMethod<{ id: string } & z.input<typeof sessionFolderInputSchema>, SessionFolderState>(),
  "session_folders.remove": ipcMethod<{ id: string }, SessionFolderState>(),
  "session_folders.assign": ipcMethod<{ sessionId: string } & z.input<typeof sessionFolderAssignmentSchema>, SessionFolderState>(),
  "directories.list": ipcMethod<undefined, RecentDirectory[]>(),
  "directories.favorite": ipcMethod<{
      path: string;
      favorite: boolean;
      alias?: string | null;
    }, RecentDirectory[]>(),
  "directories.browse": ipcMethod<{ root: string; path?: string }, DirectoryBrowseResult>(),
  "schedules.list": ipcMethod<undefined, ScheduledJob[]>(),
  "schedules.get": ipcMethod<{ id: string }, ScheduledJob>(),
  "schedules.runs": ipcMethod<{ jobId?: string } | undefined, ScheduledRun[]>(),
  "schedules.create": ipcMethod<z.input<typeof jobInputSchema>, ScheduledJobView>(),
  "schedules.update": ipcMethod<{ id: string } & z.input<typeof jobInputSchema>, ScheduledJobView>(),
  "schedules.enable": ipcMethod<{ id: string; enabled: boolean }, ScheduledJobView>(),
  "schedules.delete": ipcMethod<{ id: string }, { id: string; deleted: true }>(),
  "schedules.run_now": ipcMethod<{ id: string }, ScheduledRun>(),
  "scheduler.tool": ipcMethod<{
      token: string;
      sessionId: string;
      input: Record<string, unknown>;
    }, unknown>("extension"),
  "pi.status": ipcMethod<undefined, PiStatus>(),
  "pi.update_status": ipcMethod<{ force?: boolean } | undefined, PiUpdateInfo>(),
  "pi.package": ipcMethod<{
      action: "install" | "remove" | "update_all";
      source?: string;
      force?: boolean;
    }, { stdout: string; stderr: string }>(),
  "settings.get": ipcMethod<undefined, PiWebSettings>(),
  "settings.update": ipcMethod<z.input<typeof settingsUpdateSchema>, PiWebSettings>(),
  "auth.get_hash": ipcMethod<undefined, AccessKeyHash | null>(),
  "auth.set_hash": ipcMethod<{ hash: AccessKeyHash }, { updated: true }>(),
  "auth.rotate": ipcMethod<AuthRotateInput, AuthRotateResult>(),
  "auth.get_sessions": ipcMethod<undefined, unknown>(),
  "auth.set_sessions": ipcMethod<{ sessions: unknown }, { updated: true }>(),
  "notifications.list": ipcMethod<{ limit?: number } | undefined, NotificationSummary>(),
  "notifications.read": ipcMethod<{ id: string }, NotificationRecord>(),
  "notifications.read_all": ipcMethod<undefined, NotificationSummary>(),
  "notifications.read_session": ipcMethod<{ sessionId: string }, NotificationSummary>(),
  "notifications.dismiss": ipcMethod<{ id: string }, NotificationRecord>(),
  "push.vapid.get": ipcMethod<undefined, PushVapidKeys | null>(),
  "push.vapid.set": ipcMethod<PushVapidKeys, PushVapidKeys>(),
  "push.subscription.upsert": ipcMethod<{
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent?: string | null;
    }, PushSubscriptionRecord>(),
  "push.subscription.delete": ipcMethod<{ endpoint: string }, { deleted: boolean }>(),
  "push.deliveries.pending": ipcMethod<{ limit?: number } | undefined, PushDeliveryTarget[]>(),
  "push.delivery.record": ipcMethod<{
      notificationId: string;
      subscriptionId: string;
      delivered: boolean;
      errorSummary?: string | null;
    }, { recorded: true }>(),
  "audit.login": ipcMethod<{ success: boolean; remote?: string | null }, { recorded: true }>(),
  doctor: ipcMethod<undefined, SessiondDoctorResult>(),
} as const;

export type IpcMethodMap = typeof ipcContract;

export type IpcMethod = keyof typeof ipcContract;
export type IpcMethodParams<M extends IpcMethod> = IpcMethodMap[M]["params"];
export type IpcMethodResult<M extends IpcMethod> = IpcMethodMap[M]["result"];
export type IpcRequestArguments<M extends IpcMethod> =
  undefined extends IpcMethodParams<M>
    ? [params?: IpcMethodParams<M>, timeoutMs?: number]
    : [params: IpcMethodParams<M>, timeoutMs?: number];

export function isIpcMethod(value: unknown): value is IpcMethod {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ipcContract, value)
  );
}
