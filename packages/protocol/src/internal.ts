import { z } from "zod";
import type { NotificationRecord } from "./notifications.js";
import type { RealtimeEvent } from "./sessions.js";

export const internalProtocolVersion = 3;

export interface InternalRequest {
  kind: "request";
  protocolVersion: number;
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

export interface InternalRealtimeEvent {
  kind: "event";
  event: RealtimeEvent;
}

export interface InternalNotificationEvent {
  kind: "notification";
  notification: NotificationRecord;
}

export interface InternalNotificationRefreshEvent {
  kind: "notification_refresh";
}

export type InternalMessage =
  | InternalRequest
  | InternalResponse
  | InternalRealtimeEvent
  | InternalNotificationEvent
  | InternalNotificationRefreshEvent;

export const browserSocketMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribe"),
    sessionId: z.string().uuid(),
    projectionEpoch: z.string().uuid().nullable().default(null),
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
    record.kind === "event" ||
    record.kind === "notification" ||
    record.kind === "notification_refresh"
  );
}
