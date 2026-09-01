import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { encodeJsonl, LfJsonlDecoder } from "@pi-web/ipc";
import { internalProtocolVersion } from "@pi-web/protocol";
import { Type, type Static } from "typebox";

const actionSchema = Type.Union([
  Type.Literal("create"),
  Type.Literal("list"),
  Type.Literal("get"),
  Type.Literal("update"),
  Type.Literal("enable"),
  Type.Literal("disable"),
  Type.Literal("delete"),
  Type.Literal("run_now")
]);

const inputSchema = Type.Object({
  action: actionSchema,
  jobId: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  cronExpression: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  thinkingLevel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
  enabled: Type.Optional(Type.Boolean())
});
export type ScheduleInput = Static<typeof inputSchema>;

export interface SchedulerContext {
  socket: string;
  token: string;
  sessionId: string;
}

interface SchedulerTransportOptions {
  maxResponseBytes?: number;
  timeoutMs?: number;
}

const defaultMaxSchedulerResponseBytes = 64 * 1024 * 1024;

export default function piWebScheduler(pi: ExtensionAPI): void {
  const context: SchedulerContext | null =
    process.env.PI_WEB_SCHEDULER_SOCKET &&
    process.env.PI_WEB_SCHEDULER_TOKEN &&
    process.env.PI_WEB_SESSION_ID
      ? {
          socket: process.env.PI_WEB_SCHEDULER_SOCKET,
          token: process.env.PI_WEB_SCHEDULER_TOKEN,
          sessionId: process.env.PI_WEB_SESSION_ID
        }
      : null;

  // Pi launches bash/tool children after extensions load. Remove the token from
  // the process environment after capture so it is not inherited by tools.
  delete process.env.PI_WEB_SCHEDULER_SOCKET;
  delete process.env.PI_WEB_SCHEDULER_TOKEN;
  delete process.env.PI_WEB_SESSION_ID;

  if (!context) return;

  pi.registerTool({
    name: "pi_web_schedule",
    label: "Pi Web Schedule",
    description:
      "Create and manage Pi Web cron schedules. Use only when the user asks for recurring or scheduled work.",
    parameters: inputSchema,
    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as ScheduleInput;
      const result = await callScheduler(
        context,
        { ...params, source: "model" },
        signal
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        details: result
      };
    }
  });
}

export async function callScheduler(
  context: SchedulerContext,
  input: ScheduleInput & { source: "model" },
  signal?: AbortSignal,
  options: SchedulerTransportOptions = {}
): Promise<unknown> {
  if (signal?.aborted) {
    throw new Error("Scheduler request aborted");
  }

  const id = randomUUID();
  return await new Promise((resolve, reject) => {
    const socket = createConnection(context.socket);
    let requestSent = false;
    let handshakeId: string | null = null;
    let handshakeComplete = false;
    let settled = false;
    const maxResponseBytes =
      options.maxResponseBytes ?? defaultMaxSchedulerResponseBytes;
    const timeoutMs = options.timeoutMs ?? 10_000;

    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      socket.setTimeout(0);
      socket.destroy();
    };
    const succeed = (value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const abort = () => {
      fail(new Error("Scheduler request aborted"));
    };

    const writeRequest = () => {
      requestSent = true;
      socket.write(
        encodeJsonl({
          kind: "request",
          protocolVersion: internalProtocolVersion,
          id,
          method: "scheduler.tool",
          params: {
            token: context.token,
            sessionId: context.sessionId,
            input
          }
        }),
        (error) => {
          if (error) fail(normalizeConnectionCloseError(error));
        }
      );
    };

    socket.setTimeout(timeoutMs, () => {
      fail(new Error("Scheduler request timed out"));
    });
    socket.on("connect", () => {
      if (settled) return;
      handshakeId = randomUUID();
      socket.write(
        encodeJsonl({
          kind: "request",
          protocolVersion: internalProtocolVersion,
          id: handshakeId,
          method: "protocol.handshake",
          params: { role: "extension" }
        }),
        (error) => {
          if (error) fail(normalizeConnectionCloseError(error));
        }
      );
    });
    const responseDecoder = new LfJsonlDecoder({
      maxLineBytes: maxResponseBytes,
      onValue: (value) => {
        if (settled || !value || typeof value !== "object") return;
        const message = value as {
          kind?: string;
          id?: string;
          ok?: boolean;
          result?: unknown;
          error?: { message?: string };
        };
        if (message.kind !== "response") return;
        if (!handshakeComplete && message.id === handshakeId) {
          if (!message.ok) {
            fail(new Error(message.error?.message || "Scheduler handshake failed"));
            return;
          }
          const result = message.result as
            | { protocolVersion?: number; role?: string }
            | undefined;
          if (
            result?.protocolVersion !== internalProtocolVersion ||
            result.role !== "extension"
          ) {
            fail(new Error("Scheduler IPC protocol handshake is incompatible"));
            return;
          }
          handshakeComplete = true;
          if (!requestSent) writeRequest();
          return;
        }
        if (message.id !== id) return;
        if (message.ok) succeed(message.result);
        else fail(new Error(message.error?.message || "Scheduler request failed"));
      },
      onError: (error) =>
        fail(
          error.message.startsWith("JSONL record exceeds")
            ? new Error(`Scheduler response exceeds ${maxResponseBytes} bytes`)
            : error
        )
    });
    socket.on("data", (chunk: Buffer) => responseDecoder.push(chunk));
    socket.on("error", (error) => {
      fail(normalizeConnectionCloseError(error));
    });
    socket.on("end", () => {
      responseDecoder.end();
      fail(new Error("Scheduler connection ended before a response"));
    });
    socket.on("close", () => {
      fail(new Error("Scheduler connection closed before a response"));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function normalizeConnectionCloseError(error: Error & { code?: string }): Error {
  if (error.code !== "EPIPE" && error.code !== "ECONNRESET") return error;

  return new Error("Scheduler connection closed before a response", {
    cause: error
  });
}
