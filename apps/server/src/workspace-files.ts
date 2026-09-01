import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { PiWebConfig } from "@pi-web/config";
import type { SessionRecord } from "@pi-web/protocol";
import {
  PiWebError,
  resolveAllowedDirectory,
  resolveContainedPath
} from "@pi-web/shared";
import { sniffFile } from "./file-response.js";

export async function authorizeSessionWorkspace(
  session: Pick<SessionRecord, "cwd">,
  config: Pick<PiWebConfig, "allowedRoots" | "allowAnyDirectory">
): Promise<string> {
  return await authorizeWorkspace(session.cwd, config);
}

export async function authorizeWorkspace(
  cwd: string,
  config: Pick<PiWebConfig, "allowedRoots" | "allowAnyDirectory">
): Promise<string> {
  return await resolveAllowedDirectory(
    cwd,
    config.allowedRoots,
    config.allowAnyDirectory
  );
}

export async function listWorkspaceEntries(
  cwd: string,
  requestedPath = ""
): Promise<{
  path: string;
  truncated: boolean;
  entries: Array<{
    name: string;
    path: string;
    directory: boolean;
    size: number;
    modifiedAt: string;
    mime: string | null;
    preview: "text" | "image" | "audio" | "video" | "pdf" | "none";
  }>;
}> {
  const target = await resolveContainedPath(cwd, requestedPath);
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new PiWebError("NOT_A_DIRECTORY", "Path is not a directory", 400);
  }
  const entries = await readdir(target, { withFileTypes: true });
  const limited = entries.slice(0, 2000);
  const visibleEntries = await mapWithConcurrency(
    limited,
    32,
    async (entry) => {
      try {
        const entryPath = relative(cwd, join(target, entry.name));
        const path = await resolveContainedPath(cwd, entryPath);
        const item = await stat(path);
        const sniffed = item.isFile() ? await sniffFile(path) : null;
        return {
          name: entry.name,
          path: toWorkspacePath(cwd, path),
          directory: item.isDirectory(),
          size: item.size,
          modifiedAt: item.mtime.toISOString(),
          mime: sniffed?.mime ?? null,
          preview: sniffed?.preview ?? "none"
        };
      } catch (error) {
        if (
          error instanceof PiWebError &&
          (error.code === "PATH_ESCAPE" || error.code === "PATH_NOT_FOUND")
        ) {
          return null;
        }
        throw error;
      }
    }
  );
  return {
    path: toWorkspacePath(cwd, target),
    truncated: entries.length > limited.length,
    entries: visibleEntries.filter((entry) => entry !== null)
  };
}

export async function readWorkspaceText(
  cwd: string,
  requestedPath: string
): Promise<{ path: string; mime: string; content: string }> {
  const target = await resolveContainedPath(cwd, requestedPath);
  const info = await stat(target);
  if (!info.isFile()) {
    throw new PiWebError("NOT_A_FILE", "Path is not a file", 400);
  }
  if (info.size > 2 * 1024 * 1024) {
    throw new PiWebError("FILE_TOO_LARGE", "Text preview is limited to 2 MB", 413);
  }
  const sniffed = await sniffFile(target);
  if (sniffed.preview !== "text") {
    throw new PiWebError("NOT_TEXT", "File is not recognized as safe text", 415);
  }
  const handle = await open(target, "r");
  try {
    return {
      path: toWorkspacePath(cwd, target),
      mime: sniffed.mime,
      content: await handle.readFile({ encoding: "utf8" })
    };
  } finally {
    await handle.close();
  }
}

export interface WorkspaceEntryMutationResult {
  path: string;
  name: string;
  directory: boolean;
}

export async function createWorkspaceEntry(
  cwd: string,
  directoryPath: string,
  name: string,
  directory: boolean
): Promise<WorkspaceEntryMutationResult> {
  const safeName = validateWorkspaceEntryName(name);
  const parent = await resolveContainedPath(cwd, directoryPath);
  const parentInfo = await stat(parent);
  if (!parentInfo.isDirectory()) {
    throw new PiWebError("NOT_A_DIRECTORY", "Parent path is not a directory", 400);
  }
  const target = join(parent, safeName);
  try {
    if (directory) {
      await mkdir(target, { mode: 0o700 });
    } else {
      await writeFile(target, "", { flag: "wx", mode: 0o600 });
    }
  } catch (error) {
    throw mapMutationError(error);
  }
  return {
    path: toWorkspacePath(cwd, target),
    name: safeName,
    directory
  };
}

export async function renameWorkspaceEntry(
  cwd: string,
  entryPath: string,
  name: string
): Promise<WorkspaceEntryMutationResult> {
  const safeName = validateWorkspaceEntryName(name);
  const parentPath = dirname(entryPath);
  const parent = await resolveContainedPath(
    cwd,
    parentPath === "." ? "" : parentPath
  );
  const lexicalSource = join(parent, basename(entryPath));
  let sourceInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceInfo = await lstat(lexicalSource);
  } catch (error) {
    throw mapMutationError(error);
  }
  if (sourceInfo.isSymbolicLink()) {
    throw new PiWebError(
      "SYMLINK_MUTATION_FORBIDDEN",
      "Symbolic links cannot be renamed from the web file browser",
      400
    );
  }
  const source = await resolveContainedPath(cwd, entryPath);
  if (!relative(cwd, source)) {
    throw new PiWebError(
      "WORKSPACE_ROOT_MUTATION_FORBIDDEN",
      "The workspace root cannot be renamed",
      400
    );
  }
  const target = join(parent, safeName);
  if (source === target) {
    return {
      path: toWorkspacePath(cwd, source),
      name: safeName,
      directory: sourceInfo.isDirectory()
    };
  }
  try {
    if (sourceInfo.isDirectory()) {
      if (await pathExists(target)) {
        throw new PiWebError(
          "ENTRY_ALREADY_EXISTS",
          "A file or directory with that name already exists",
          409
        );
      }
      await rename(source, target);
    } else {
      await renameFileWithoutReplacing(source, target);
    }
  } catch (error) {
    throw mapMutationError(error);
  }
  return {
    path: toWorkspacePath(cwd, target),
    name: safeName,
    directory: sourceInfo.isDirectory()
  };
}

async function renameFileWithoutReplacing(
  source: string,
  target: string
): Promise<void> {
  await link(source, target);
  try {
    await unlink(source);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export function validateWorkspaceEntryName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(normalized) ||
    /[. ]$/u.test(normalized) ||
    normalized.length > 240
  ) {
    throw new PiWebError(
      "INVALID_ENTRY_NAME",
      "File name contains unsupported characters",
      400
    );
  }
  const stem = normalized.split(".", 1)[0]?.toUpperCase() ?? "";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(stem)) {
    throw new PiWebError(
      "INVALID_ENTRY_NAME",
      "File name is reserved by the operating system",
      400
    );
  }
  return normalized;
}

function toWorkspacePath(cwd: string, target: string): string {
  return relative(cwd, target).replaceAll("\\", "/");
}

async function pathExists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true).catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") return false;
    throw mapMutationError(error);
  });
}

function mapMutationError(error: unknown): Error {
  if (error instanceof PiWebError) return error;
  const code = nodeErrorCode(error);
  if (code === "EEXIST") {
    return new PiWebError(
      "ENTRY_ALREADY_EXISTS",
      "A file or directory with that name already exists",
      409
    );
  }
  if (code === "ENOENT") {
    return new PiWebError(
      "PATH_NOT_FOUND",
      "File or directory does not exist",
      404
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new PiWebError(
      "FILE_MUTATION_FORBIDDEN",
      "The operating system rejected this file operation",
      403
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function nodeErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : null;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker()
    )
  );
  return results;
}
