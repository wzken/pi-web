import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PiWebConfig } from "@pi-web/config";
import { isValidBase64, type SessionRecord } from "@pi-web/protocol";
import {
  PiWebError,
  resolveAllowedDirectory,
  resolveContainedPath
} from "@pi-web/shared";
import { z } from "zod";
import { SessiondClient } from "./sessiond-client.js";

const maxAttachmentBytes = 16 * 1024 * 1024;
const attachmentSchema = z.object({
  mutationId: z.string().uuid().optional(),
  cwd: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(240),
  data: z
    .string()
    .min(1)
    .max(Math.ceil((maxAttachmentBytes * 4) / 3) + 4)
    .refine(isValidBase64, "Attachment data must be valid padded base64")
});
const workspaceEntryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .transform(validateWorkspaceEntryName);
const createWorkspaceEntrySchema = z.object({
  path: z.string().max(4096).default(""),
  name: workspaceEntryNameSchema,
  directory: z.boolean().default(false)
});
const renameWorkspaceEntrySchema = z.object({
  path: z.string().min(1).max(4096),
  name: workspaceEntryNameSchema
});

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".sh",
  ".ps1"
]);

export function registerFileRoutes(
  app: FastifyInstance,
  client: SessiondClient,
  getConfig: () => PiWebConfig
): void {
  app.post<{ Body: unknown }>("/api/attachments", async (request, reply) => {
    const input = attachmentSchema.parse(request.body);
    const data = Buffer.from(input.data, "base64");
    if (data.length > maxAttachmentBytes) {
      throw new PiWebError(
        "ATTACHMENT_TOO_LARGE",
        "Attachment is limited to 16 MB",
        413
      );
    }
    const config = getConfig();
    const cwd = await resolveAllowedDirectory(
      input.cwd,
      config.allowedRoots,
      config.allowAnyDirectory
    );
    return reply
      .code(201)
      .send(
        await saveAttachment(cwd, input.name, data, input.mutationId)
      );
  });

  app.get<{
    Params: { id: string };
    Querystring: { path?: string };
  }>("/api/sessions/:id/files", async (request) => {
    const session = await client.request<SessionRecord>("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const target = await resolveContainedPath(cwd, request.query.path ?? "");
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
          const entryPath = relative(
            cwd,
            join(target, entry.name)
          );
          const path = await resolveContainedPath(cwd, entryPath);
          const item = await stat(path);
          const sniffed = item.isFile() ? await sniffFile(path) : null;
          return {
            name: entry.name,
            path: relative(cwd, path),
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
      path: relative(cwd, target),
      truncated: entries.length > limited.length,
      entries: visibleEntries.filter((entry) => entry !== null)
    };
  });

  app.post<{
    Params: { id: string };
    Body: unknown;
  }>("/api/sessions/:id/file-entry", async (request, reply) => {
    const session = await client.request<SessionRecord>("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const input = createWorkspaceEntrySchema.parse(request.body);
    return reply.code(201).send(
      await createWorkspaceEntry(
        cwd,
        input.path,
        input.name,
        input.directory
      )
    );
  });

  app.put<{
    Params: { id: string };
    Body: unknown;
  }>("/api/sessions/:id/file-entry", async (request) => {
    const session = await client.request<SessionRecord>("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const input = renameWorkspaceEntrySchema.parse(request.body);
    return await renameWorkspaceEntry(cwd, input.path, input.name);
  });

  app.get<{
    Params: { id: string };
    Querystring: { path: string };
  }>("/api/sessions/:id/file-text", async (request) => {
    const session = await client.request<SessionRecord>("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const target = await resolveContainedPath(cwd, request.query.path);
    const info = await stat(target);
    if (!info.isFile()) throw new PiWebError("NOT_A_FILE", "Path is not a file", 400);
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
        path: relative(cwd, target),
        mime: sniffed.mime,
        content: await handle.readFile({ encoding: "utf8" })
      };
    } finally {
      await handle.close();
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { path: string; download?: string };
  }>("/api/sessions/:id/file-raw", async (request, reply) => {
    const session = await client.request<SessionRecord>("sessions.get", {
      id: request.params.id
    });
    const cwd = await authorizeSessionWorkspace(session, getConfig());
    const target = await resolveContainedPath(cwd, request.query.path);
    await sendRawFile(request, reply, target, request.query.download === "1");
  });
}

export async function authorizeSessionWorkspace(
  session: Pick<SessionRecord, "cwd">,
  config: Pick<PiWebConfig, "allowedRoots" | "allowAnyDirectory">
): Promise<string> {
  return await resolveAllowedDirectory(
    session.cwd,
    config.allowedRoots,
    config.allowAnyDirectory
  );
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

export async function saveAttachment(
  cwd: string,
  originalName: string,
  data: Buffer,
  mutationId?: string
): Promise<{ path: string; name: string; size: number }> {
  if (mutationId) {
    return await serializeAttachmentMutation(cwd, mutationId, async () =>
      await saveIdempotentAttachment(cwd, originalName, data, mutationId)
    );
  }
  const directory = await ensureContainedDirectory(
    cwd,
    ".pi-web/attachments"
  );
  const safeName = sanitizeAttachmentName(originalName);
  const storedName = `${randomUUID().slice(0, 8)}-${safeName}`;
  const target = join(directory, storedName);
  await writeFile(target, data, { flag: "wx", mode: 0o600 });
  return {
    path: relative(cwd, target).replaceAll("\\", "/"),
    name: originalName,
    size: data.length
  };
}

const attachmentMutationQueues = new Map<string, Promise<void>>();

async function serializeAttachmentMutation<T>(
  cwd: string,
  mutationId: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = JSON.stringify([cwd, mutationId]);
  const previous = attachmentMutationQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  attachmentMutationQueues.set(key, tail);
  try {
    return await result;
  } finally {
    if (attachmentMutationQueues.get(key) === tail) {
      attachmentMutationQueues.delete(key);
    }
  }
}

async function saveIdempotentAttachment(
  cwd: string,
  originalName: string,
  data: Buffer,
  mutationId: string
): Promise<{ path: string; name: string; size: number }> {
  const directory = await ensureContainedDirectory(
    cwd,
    ".pi-web/attachments"
  );
  const safeName = sanitizeAttachmentName(originalName);
  const nameHash = createHash("sha256")
    .update(originalName)
    .digest("hex")
    .slice(0, 12);
  const storedName = `${mutationId}-${nameHash}-${safeName}`;
  const existingNames = (await readdir(directory)).filter((name) =>
    name.startsWith(`${mutationId}-`)
  );
  if (existingNames.length > 0 && !existingNames.includes(storedName)) {
    throw attachmentMutationConflict();
  }
  const target = join(directory, storedName);
  if (existingNames.includes(storedName)) {
    const existing = await readSafeAttachment(cwd, target);
    if (!existing.equals(data)) throw attachmentMutationConflict();
  } else {
    await publishAttachmentAtomically(cwd, target, data);
  }
  await readSafeAttachment(cwd, target);
  return {
    path: relative(cwd, target).replaceAll("\\", "/"),
    name: originalName,
    size: data.length
  };
}

async function publishAttachmentAtomically(
  cwd: string,
  target: string,
  data: Buffer
): Promise<void> {
  const temporary = join(
    dirname(target),
    `.pi-web-upload-${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      // A same-directory hard link publishes the fully-written inode without
      // replacing a path that Pi or another process may have created.
      await link(temporary, target);
    } catch (error) {
      if (nodeErrorCode(error) !== "EEXIST") throw error;
      const existing = await readSafeAttachment(cwd, target);
      if (!existing.equals(data)) throw attachmentMutationConflict();
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

async function readSafeAttachment(
  cwd: string,
  target: string
): Promise<Buffer> {
  const before = await lstat(target).catch((error: unknown) => {
    throw nodeErrorCode(error) === "ENOENT"
      ? attachmentMutationConflict()
      : error;
  });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw attachmentMutationConflict();
  }
  const relativeTarget = relative(cwd, target);
  const contained = await resolveContainedPath(cwd, relativeTarget);
  if ((await realpath(contained)) !== (await realpath(target))) {
    throw attachmentMutationConflict();
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(target, constants.O_RDONLY | noFollow).catch(
    (error: unknown) => {
      if (["ELOOP", "EMLINK"].includes(nodeErrorCode(error) ?? "")) {
        throw attachmentMutationConflict();
      }
      throw error;
    }
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw attachmentMutationConflict();
    }
    const data = await handle.readFile();
    const after = await lstat(target).catch(() => null);
    if (
      !after ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      !sameFileIdentity(opened, after)
    ) {
      throw attachmentMutationConflict();
    }
    return data;
  } finally {
    await handle.close();
  }
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof stat>>,
  right: Awaited<ReturnType<typeof stat>>
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function attachmentMutationConflict(): PiWebError {
  return new PiWebError(
    "MUTATION_ID_REUSED",
    "Attachment mutation ID was reused with different input",
    409
  );
}

export function sanitizeAttachmentName(value: string): string {
  const normalized = basename(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120);
  return normalized || "attachment";
}

async function ensureContainedDirectory(
  root: string,
  relativePath: string
): Promise<string> {
  try {
    const existing = await resolveContainedPath(root, relativePath);
    const info = await stat(existing);
    if (!info.isDirectory()) {
      throw new PiWebError(
        "ATTACHMENT_PATH_INVALID",
        "Attachment path is not a directory",
        409
      );
    }
    return existing;
  } catch (error) {
    if (!(error instanceof PiWebError) || error.code !== "PATH_NOT_FOUND") {
      throw error;
    }
  }
  const parentPath = dirname(relativePath);
  const parent =
    parentPath === "."
      ? await resolveContainedPath(root, "")
      : await ensureContainedDirectory(root, parentPath);
  await mkdir(join(parent, basename(relativePath)), {
    recursive: true,
    mode: 0o700
  });
  return await resolveContainedPath(root, relativePath);
}

async function sendRawFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
  forceDownload: boolean
): Promise<FastifyReply> {
  const info = await stat(path);
  if (!info.isFile()) throw new PiWebError("NOT_A_FILE", "Path is not a file", 400);
  const sniffed = await sniffFile(path);
  const filename = basename(path);
  const dangerousDocument =
    extname(filename).toLowerCase() === ".svg" ||
    extname(filename).toLowerCase() === ".html" ||
    extname(filename).toLowerCase() === ".htm";
  const disposition =
    forceDownload || dangerousDocument || sniffed.preview === "none"
      ? "attachment"
      : "inline";
  reply.header(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header(
    "Content-Security-Policy",
    "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
  );
  reply.header("Accept-Ranges", "bytes");
  reply.type(dangerousDocument ? "text/plain; charset=utf-8" : sniffed.mime);

  const range = parseRange(request.headers.range, info.size);
  if (range) {
    reply.code(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    reply.header("Content-Length", range.end - range.start + 1);
    return reply.send(createReadStream(path, range));
  }
  reply.header("Content-Length", info.size);
  return reply.send(createReadStream(path));
}

interface SniffResult {
  mime: string;
  preview: "text" | "image" | "audio" | "video" | "pdf" | "none";
}

async function sniffFile(path: string): Promise<SniffResult> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4100);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { mime: "image/png", preview: "image" };
    }
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { mime: "image/jpeg", preview: "image" };
    }
    if (data.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
      return { mime: "image/gif", preview: "image" };
    }
    if (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return { mime: "image/webp", preview: "image" };
    }
    if (data.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { mime: "application/pdf", preview: "pdf" };
    }
    if (data.subarray(0, 4).toString("ascii") === "OggS") {
      return { mime: "audio/ogg", preview: "audio" };
    }
    if (
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WAVE"
    ) {
      return { mime: "audio/wav", preview: "audio" };
    }
    if (data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && (data[1] ?? 0) >= 0xe0)) {
      return { mime: "audio/mpeg", preview: "audio" };
    }
    if (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp") {
      return { mime: "video/mp4", preview: "video" };
    }
    const ext = extname(path).toLowerCase();
    if (isLikelyText(data) && TEXT_EXTENSIONS.has(ext)) {
      const mime =
        ext === ".md" || ext === ".markdown"
          ? "text/markdown; charset=utf-8"
          : ext === ".json" || ext === ".jsonl"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8";
      return { mime, preview: "text" };
    }
    return { mime: "application/octet-stream", preview: "none" };
  } finally {
    await handle.close();
  }
}

function isLikelyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
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

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) throw new PiWebError("INVALID_RANGE", "Invalid Range header", 416);
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      throw new PiWebError("INVALID_RANGE", "Invalid suffix range", 416);
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    throw new PiWebError("RANGE_NOT_SATISFIABLE", "Range not satisfiable", 416);
  }
  return { start, end: Math.min(end, size - 1) };
}
