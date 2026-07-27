import type { FastifyInstance } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import type { SessionRecord } from "@pi-web/protocol";
import {
  PiWebError,
  resolveAllowedDirectory,
  safeErrorMessage
} from "@pi-web/shared";
import { z } from "zod";
import { SessiondClient } from "./sessiond-client.js";
import {
  TerminalManager,
  type TerminalPeer,
  type TerminalServerMessage
} from "./terminal-manager.js";

const dimensionsSchema = {
  columns: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200)
};
const terminalMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    sessionId: z.string().uuid(),
    ...dimensionsSchema
  }),
  z.object({
    type: z.literal("attach"),
    terminalId: z.string().uuid(),
    sessionId: z.string().uuid(),
    ...dimensionsSchema
  }),
  z.object({
    type: z.literal("input"),
    data: z.string().min(1).max(64 * 1024)
  }),
  z.object({
    type: z.literal("resize"),
    ...dimensionsSchema
  }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("ping") })
]);

interface BrowserSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(value: string): void;
  on(event: "message", listener: (value: unknown) => void): void;
  on(event: "close" | "error", listener: () => void): void;
}

export function registerTerminalRoutes(
  app: FastifyInstance,
  client: SessiondClient,
  getConfig: () => PiWebConfig,
  manager = new TerminalManager()
): TerminalManager {
  app.get("/api/terminal", { websocket: true }, (rawSocket) => {
    const socket = rawSocket as unknown as BrowserSocket;
    let terminalId: string | null = null;
    let messageQueue = Promise.resolve();
    const peer: TerminalPeer = {
      send(message) {
        send(socket, message);
        if (message.type === "exit") terminalId = null;
      }
    };

    async function handle(raw: unknown): Promise<void> {
      const input = terminalMessageSchema.parse(JSON.parse(String(raw)));
      if (input.type === "ping") {
        peer.send({ type: "pong", at: Date.now() });
        return;
      }
      if (input.type === "start") {
        if (terminalId) {
          throw new PiWebError(
            "TERMINAL_ALREADY_STARTED",
            "This connection already owns a terminal",
            409
          );
        }
        const session = await client.request<SessionRecord>("sessions.get", {
          id: input.sessionId
        });
        const config = getConfig();
        const cwd = await resolveAllowedDirectory(
          session.cwd,
          config.allowedRoots,
          config.allowAnyDirectory
        );
        terminalId = manager.create({
          sessionId: session.id,
          cwd,
          columns: input.columns,
          rows: input.rows,
          peer
        });
        return;
      }
      if (input.type === "attach") {
        if (terminalId) {
          throw new PiWebError(
            "TERMINAL_ALREADY_STARTED",
            "This connection already owns a terminal",
            409
          );
        }
        manager.attach({
          terminalId: input.terminalId,
          sessionId: input.sessionId,
          peer
        });
        terminalId = input.terminalId;
        manager.resize(terminalId, input.columns, input.rows);
        return;
      }
      if (!terminalId) {
        throw new PiWebError(
          "TERMINAL_NOT_STARTED",
          "Start or reconnect a terminal first",
          409
        );
      }
      if (input.type === "input") {
        manager.write(terminalId, input.data);
      } else if (input.type === "resize") {
        manager.resize(terminalId, input.columns, input.rows);
      } else {
        manager.stop(terminalId);
      }
    }

    socket.on("message", (raw) => {
      messageQueue = messageQueue
        .then(() => handle(raw))
        .catch((error) => {
          peer.send({
            type: "error",
            code: error instanceof PiWebError ? error.code : "TERMINAL_ERROR",
            message: safeErrorMessage(error)
          });
        });
    });
    const detach = () => manager.detach(peer);
    socket.on("close", detach);
    socket.on("error", detach);
  });
  app.addHook("onClose", () => manager.closeAll());
  return manager;
}

function send(socket: BrowserSocket, message: TerminalServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
