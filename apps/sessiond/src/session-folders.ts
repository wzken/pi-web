import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PiWebPaths } from "@pi-web/config";
import {
  sessionFolderAssignmentSchema,
  sessionFolderInputSchema,
  type SessionFolderState
} from "@pi-web/protocol";
import { PiWebError } from "@pi-web/shared";
import { z } from "zod";
import { AuditStore } from "./audit-store.js";
import { SessionStore } from "./session-store.js";
import { SettingsStore } from "./settings-store.js";

const sessionFolderSettingKey = "session_folders_v1";

const persistedStateSchema = z
  .object({
    folders: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(80),
        createdAt: z.string()
      })
    ),
    assignments: z.record(z.string().uuid(), z.string().uuid())
  })
  .superRefine((state, context) => {
    const folderIds = new Set<string>();
    for (const [index, folder] of state.folders.entries()) {
      if (folderIds.has(folder.id)) {
        context.addIssue({
          code: "custom",
          path: ["folders", index, "id"],
          message: "Folder IDs must be unique"
        });
      }
      folderIds.add(folder.id);
    }
    for (const [sessionId, folderId] of Object.entries(state.assignments)) {
      if (!folderIds.has(folderId)) {
        context.addIssue({
          code: "custom",
          path: ["assignments", sessionId],
          message: "Assignment references a missing folder"
        });
      }
    }
  });

const emptyState: SessionFolderState = {
  folders: [],
  assignments: {}
};

type Transaction = <T>(operation: () => T) => T;

/**
 * Session folders are Pi Web metadata, but their durable owner is Sessiond
 * alongside the session index. The HTTP server only forwards these commands.
 */
export class SessionFolderStore {
  readonly #settings: SettingsStore;
  readonly #sessions: SessionStore;
  readonly #transaction: Transaction;
  readonly #audit: AuditStore;
  readonly #legacyFile: string;
  #initializationError: PiWebError | null = null;

  constructor(
    settings: SettingsStore,
    sessions: SessionStore,
    transaction: Transaction,
    audit: AuditStore,
    paths: PiWebPaths
  ) {
    this.#settings = settings;
    this.#sessions = sessions;
    this.#transaction = transaction;
    this.#audit = audit;
    this.#legacyFile = join(paths.configDir, "session-folders.json");
  }

  async initialize(): Promise<void> {
    try {
      if (this.#settings.get<unknown>(sessionFolderSettingKey) !== null) {
        this.#read();
        return;
      }
    } catch {
      this.#recordInitializationError();
      return;
    }

    let state: SessionFolderState = structuredClone(emptyState);
    try {
      state = this.#parseState(
        JSON.parse(await readFile(this.#legacyFile, "utf8"))
      );
      this.#audit.write("session_folders.migrate", "success", "system", null, {
        folders: state.folders.length,
        assignments: Object.keys(state.assignments).length
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.#write(state);
        return;
      }
      this.#recordInitializationError();
      return;
    }
    this.#write(state);
  }

  get(): SessionFolderState {
    return structuredClone(this.#read());
  }

  create(input: unknown): SessionFolderState {
    const { name } = sessionFolderInputSchema.parse(input);
    return this.#mutate("session_folder.create", (state) => {
      if (
        state.folders.some(
          (folder) =>
            folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        )
      ) {
        throw new PiWebError(
          "SESSION_FOLDER_EXISTS",
          "A conversation folder with this name already exists",
          409
        );
      }
      state.folders.push({
        id: randomUUID(),
        name,
        createdAt: new Date().toISOString()
      });
    });
  }

  rename(id: string, input: unknown): SessionFolderState {
    const { name } = sessionFolderInputSchema.parse(input);
    return this.#mutate("session_folder.rename", (state) => {
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) throw folderNotFoundError();
      if (
        state.folders.some(
          (item) =>
            item.id !== id &&
            item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        )
      ) {
        throw new PiWebError(
          "SESSION_FOLDER_EXISTS",
          "A conversation folder with this name already exists",
          409
        );
      }
      folder.name = name;
    });
  }

  remove(id: string): SessionFolderState {
    return this.#mutate("session_folder.remove", (state) => {
      const folders = state.folders.filter((folder) => folder.id !== id);
      if (folders.length === state.folders.length) {
        throw folderNotFoundError();
      }
      state.folders = folders;
      state.assignments = Object.fromEntries(
        Object.entries(state.assignments).filter(
          ([, folderId]) => folderId !== id
        )
      );
    });
  }

  assign(sessionId: string, input: unknown): SessionFolderState {
    const { folderId } = sessionFolderAssignmentSchema.parse(input);
    this.#sessions.get(sessionId);
    return this.#mutate("session_folder.assign", (state) => {
      if (
        folderId &&
        !state.folders.some((folder) => folder.id === folderId)
      ) {
        throw folderNotFoundError();
      }
      if (folderId) state.assignments[sessionId] = folderId;
      else delete state.assignments[sessionId];
    });
  }

  #mutate(
    auditType: string,
    change: (state: SessionFolderState) => void
  ): SessionFolderState {
    return this.#transaction(() => {
      const state = this.#read();
      change(state);
      this.#write(state);
      this.#audit.write(auditType, "success", "web");
      return structuredClone(state);
    });
  }

  #read(): SessionFolderState {
    try {
      const value = this.#settings.get<unknown>(sessionFolderSettingKey);
      if (value === null) {
        if (this.#initializationError) throw this.#initializationError;
        throw new PiWebError(
          "SESSION_FOLDERS_NOT_INITIALIZED",
          "Conversation folders are not initialized",
          503
        );
      }
      return this.#parseState(value);
    } catch (error) {
      if (
        error instanceof PiWebError &&
        error.code === "SESSION_FOLDERS_NOT_INITIALIZED"
      ) {
        throw error;
      }
      throw invalidStateError();
    }
  }

  #write(state: SessionFolderState): void {
    this.#settings.set(sessionFolderSettingKey, this.#parseState(state));
    this.#initializationError = null;
  }

  #parseState(value: unknown): SessionFolderState {
    const state = persistedStateSchema.parse(value);
    for (const sessionId of Object.keys(state.assignments)) {
      try {
        this.#sessions.get(sessionId);
      } catch (error) {
        if (
          error instanceof PiWebError &&
          error.code === "SESSION_NOT_FOUND"
        ) {
          throw invalidStateError();
        }
        throw error;
      }
    }
    return state;
  }

  #recordInitializationError(): void {
    this.#initializationError = invalidStateError();
    this.#audit.write(
      "session_folders.migrate",
      "failure",
      "system",
      null,
      { reason: "invalid conversation folder data" }
    );
  }
}

function folderNotFoundError(): PiWebError {
  return new PiWebError(
    "SESSION_FOLDER_NOT_FOUND",
    "Conversation folder not found",
    404
  );
}

function invalidStateError(): PiWebError {
  return new PiWebError(
    "SESSION_FOLDERS_INVALID",
    "Conversation folder data is invalid",
    500
  );
}
