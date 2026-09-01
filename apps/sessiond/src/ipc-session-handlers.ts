import {
  createSessionSchema,
  extensionUiResponseSchema,
  promptSchema,
  resumeSessionSchema,
  sessionListQuerySchema,
  sessionRenameSchema,
  thinkingLevels
} from "@pi-web/protocol";
import { z } from "zod";
import type { IpcHandlerMap } from "./ipc-handler.js";
import { asRecord, numberParam, optionalString, stringParam } from "./ipc-params.js";
import { SessionFolderStore } from "./session-folders.js";
import { SessionSupervisor } from "./supervisor.js";

type SessionMethod =
  | "sessions.list"
  | "sessions.get"
  | "sessions.rename"
  | "sessions.pin"
  | "sessions.delete"
  | "sessions.create"
  | "sessions.fork"
  | "sessions.resume"
  | "sessions.prompt"
  | "sessions.abort"
  | "sessions.close"
  | "sessions.model"
  | "sessions.thinking"
  | "sessions.extension_ui_response"
  | "sessions.snapshot"
  | "sessions.sync"
  | "session_folders.get"
  | "session_folders.create"
  | "session_folders.rename"
  | "session_folders.remove"
  | "session_folders.assign";

export function createSessionHandlers(
  supervisor: SessionSupervisor,
  sessionFolders: SessionFolderStore
): IpcHandlerMap<SessionMethod> {
  return {
    "sessions.list": (raw) => {
      const input = sessionListQuerySchema.parse(asRecord(raw));
      return supervisor.list({
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor })
      });
    },
    "sessions.get": (raw) => supervisor.get(stringParam(asRecord(raw), "id")),
    "sessions.rename": async (raw) => {
      const params = asRecord(raw);
      const input = sessionRenameSchema.parse(params);
      return await supervisor.rename(stringParam(params, "id"), input.displayName);
    },
    "sessions.pin": (raw) => {
      const params = asRecord(raw);
      return supervisor.pin(
        stringParam(params, "id"),
        z.boolean().parse(params.pinned)
      );
    },
    "sessions.delete": async (raw) => {
      const id = stringParam(asRecord(raw), "id");
      await supervisor.delete(id, "web", () => {
        sessionFolders.assign(id, { folderId: null });
      });
      return { deleted: true };
    },
    "sessions.create": async (raw) => {
      const input = createSessionSchema.parse(asRecord(raw));
      return await supervisor.create({
        ...(input.mutationId === undefined
          ? {}
          : { mutationId: input.mutationId }),
        cwd: input.cwd,
        displayName: input.displayName,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.images.length === 0 ? {} : { images: input.images }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: input.thinkingLevel }),
        ...(input.systemPrompt === undefined
          ? {}
          : { systemPrompt: input.systemPrompt }),
        createdBy: "web"
      });
    },
    "sessions.fork": async (raw) =>
      await supervisor.fork(stringParam(asRecord(raw), "id")),
    "sessions.resume": async (raw) => {
      const params = asRecord(raw);
      const input = resumeSessionSchema.parse(params);
      return await supervisor.resume(
        stringParam(params, "id"),
        input.prompt,
        input.images,
        input.mutationId
      );
    },
    "sessions.prompt": async (raw) => {
      const params = asRecord(raw);
      const input = promptSchema.parse(params);
      await supervisor.prompt(
        stringParam(params, "id"),
        input.message,
        input.behavior,
        input.images,
        input.mutationId
      );
      return { accepted: true };
    },
    "sessions.abort": async (raw) => {
      await supervisor.abort(stringParam(asRecord(raw), "id"));
      return { accepted: true };
    },
    "sessions.close": async (raw) => {
      await supervisor.close(stringParam(asRecord(raw), "id"));
      return { closed: true };
    },
    "sessions.model": async (raw) => {
      const params = asRecord(raw);
      await supervisor.setModel(
        stringParam(params, "id"),
        stringParam(params, "model")
      );
      return { updated: true };
    },
    "sessions.thinking": async (raw) => {
      const params = asRecord(raw);
      await supervisor.setThinkingLevel(
        stringParam(params, "id"),
        z.enum(thinkingLevels).parse(params.thinkingLevel)
      );
      return { updated: true };
    },
    "sessions.extension_ui_response": async (raw) => {
      const params = asRecord(raw);
      const sessionId = stringParam(params, "id");
      const { id: _sessionId, ...response } = params;
      return await supervisor.respondToExtensionUi(
        sessionId,
        extensionUiResponseSchema.parse(response)
      );
    },
    "sessions.snapshot": async (raw) => {
      const params = asRecord(raw);
      return await supervisor.snapshot(
        stringParam(params, "id"),
        optionalString(params.cursor)
      );
    },
    "sessions.sync": async (raw) => {
      const params = asRecord(raw);
      return await supervisor.sync(
        stringParam(params, "id"),
        optionalString(params.projectionEpoch),
        numberParam(params, "afterSequence", 0)
      );
    },
    "session_folders.get": () => sessionFolders.get(),
    "session_folders.create": (raw) => sessionFolders.create(asRecord(raw)),
    "session_folders.rename": (raw) => {
      const params = asRecord(raw);
      return sessionFolders.rename(stringParam(params, "id"), params);
    },
    "session_folders.remove": (raw) =>
      sessionFolders.remove(stringParam(asRecord(raw), "id")),
    "session_folders.assign": (raw) => {
      const params = asRecord(raw);
      return sessionFolders.assign(stringParam(params, "sessionId"), params);
    }
  };
}
