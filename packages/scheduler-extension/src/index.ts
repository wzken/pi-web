import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
type ScheduleInput = Static<typeof inputSchema>;

interface SchedulerContext {
  socket: string;
  token: string;
  sessionId: string;
}

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

async function callScheduler(
  context: SchedulerContext,
  input: ScheduleInput & { source: "model" },
  signal?: AbortSignal
): Promise<unknown> {
  const id = randomUUID();
  return await new Promise((resolve, reject) => {
    const socket = createConnection(context.socket);
    let buffer = "";
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      socket.destroy();
    };
    const abort = () => {
      cleanup();
      reject(new Error("Scheduler request aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(10_000, () => {
      cleanup();
      reject(new Error("Scheduler request timed out"));
    });
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          kind: "request",
          id,
          method: "scheduler.tool",
          params: {
            token: context.token,
            sessionId: context.sessionId,
            input
          }
        })}\n`
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const message = JSON.parse(line) as {
            kind?: string;
            id?: string;
            ok?: boolean;
            result?: unknown;
            error?: { message?: string };
          };
          if (message.kind !== "response" || message.id !== id) continue;
          cleanup();
          if (message.ok) resolve(message.result);
          else reject(new Error(message.error?.message || "Scheduler request failed"));
        } catch (error) {
          cleanup();
          reject(error);
        }
      }
    });
    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}
