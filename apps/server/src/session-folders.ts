import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PiWebPaths } from "@pi-web/config";
import {
  sessionFolderAssignmentSchema,
  sessionFolderInputSchema,
  type SessionFolderState
} from "@pi-web/protocol";
import { PiWebError } from "@pi-web/shared";
import { z } from "zod";

const persistedStateSchema = z.object({
  folders: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      createdAt: z.string()
    })
  ),
  assignments: z.record(z.string(), z.string().uuid())
});

const emptyState: SessionFolderState = {
  folders: [],
  assignments: {}
};

export class SessionFolderStore {
  private readonly file: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(paths: PiWebPaths) {
    this.file = join(paths.configDir, "session-folders.json");
  }

  async get(): Promise<SessionFolderState> {
    try {
      const value = persistedStateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8"))
      );
      return {
        folders: value.folders,
        assignments: { ...value.assignments }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(emptyState);
      }
      if (error instanceof SyntaxError || error instanceof z.ZodError) {
        throw new PiWebError(
          "SESSION_FOLDERS_INVALID",
          "Conversation folder data is invalid",
          500
        );
      }
      throw error;
    }
  }

  async create(input: unknown): Promise<SessionFolderState> {
    const { name } = sessionFolderInputSchema.parse(input);
    return await this.mutate((state) => {
      if (
        state.folders.some(
          (folder) => folder.name.toLocaleLowerCase() === name.toLocaleLowerCase()
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

  async rename(id: string, input: unknown): Promise<SessionFolderState> {
    const { name } = sessionFolderInputSchema.parse(input);
    return await this.mutate((state) => {
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) {
        throw new PiWebError(
          "SESSION_FOLDER_NOT_FOUND",
          "Conversation folder not found",
          404
        );
      }
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

  async remove(id: string): Promise<SessionFolderState> {
    return await this.mutate((state) => {
      const next = state.folders.filter((folder) => folder.id !== id);
      if (next.length === state.folders.length) {
        throw new PiWebError(
          "SESSION_FOLDER_NOT_FOUND",
          "Conversation folder not found",
          404
        );
      }
      state.folders = next;
      state.assignments = Object.fromEntries(
        Object.entries(state.assignments).filter(
          ([, folderId]) => folderId !== id
        )
      );
    });
  }

  async assign(sessionId: string, input: unknown): Promise<SessionFolderState> {
    const { folderId } = sessionFolderAssignmentSchema.parse(input);
    return await this.mutate((state) => {
      if (
        folderId &&
        !state.folders.some((folder) => folder.id === folderId)
      ) {
        throw new PiWebError(
          "SESSION_FOLDER_NOT_FOUND",
          "Conversation folder not found",
          404
        );
      }
      if (folderId) state.assignments[sessionId] = folderId;
      else delete state.assignments[sessionId];
    });
  }

  private async mutate(
    change: (state: SessionFolderState) => void
  ): Promise<SessionFolderState> {
    let result: SessionFolderState = structuredClone(emptyState);
    const operation = this.pending.then(async () => {
      const state = await this.get();
      change(state);
      await this.write(state);
      result = state;
    });
    this.pending = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return result;
  }

  private async write(state: SessionFolderState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rm(this.file, { force: true });
    await rename(temporary, this.file);
  }
}
