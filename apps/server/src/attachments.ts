import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { PiWebError, resolveContainedPath } from "@pi-web/shared";

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

function nodeErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : null;
}
