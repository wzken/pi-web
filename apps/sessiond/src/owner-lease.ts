import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink
} from "node:fs/promises";
import { basename, join } from "node:path";
import type { PiWebPaths } from "@pi-web/config";
import { PiWebError } from "@pi-web/shared";

const ownerLeaseDirectoryName = "sessiond-owner.lock";
const ownerLeaseVersion = 1;

interface OwnerRecord {
  version: 1;
  pid: number;
  nonce: string;
  createdAt: string;
}

interface OwnerSnapshot {
  name: string;
  raw: string;
  record: OwnerRecord | null;
}

export interface SessiondOwnerLease {
  readonly path: string;
  readonly pid: number;
  readonly nonce: string;
  release(): Promise<void>;
}

export interface OwnerLeaseDependencies {
  readonly pid: number;
  createNonce(): string;
  isProcessAlive(pid: number): boolean | Promise<boolean>;
  now(): Date;
}

const defaultDependencies: OwnerLeaseDependencies = {
  pid: process.pid,
  createNonce: randomUUID,
  isProcessAlive,
  now: () => new Date()
};

export function sessiondOwnerLeasePath(
  paths: Pick<PiWebPaths, "runtimeDir">
): string {
  return join(paths.runtimeDir, ownerLeaseDirectoryName);
}

export async function acquireSessiondOwnerLease(
  paths: Pick<PiWebPaths, "runtimeDir">,
  dependencies: OwnerLeaseDependencies = defaultDependencies
): Promise<SessiondOwnerLease> {
  await mkdir(paths.runtimeDir, { recursive: true, mode: 0o700 });
  const ownerDirectory = sessiondOwnerLeasePath(paths);
  const record: OwnerRecord = {
    version: ownerLeaseVersion,
    pid: dependencies.pid,
    nonce: dependencies.createNonce(),
    createdAt: dependencies.now().toISOString()
  };
  const recordName = ownerRecordName(record);
  const temporaryDirectory = `${ownerDirectory}.${recordName}.tmp`;
  const temporaryRecord = join(temporaryDirectory, recordName);
  await mkdir(temporaryDirectory, { mode: 0o700 });
  try {
    const handle = await open(temporaryRecord, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await publishOwner(temporaryDirectory, ownerDirectory)) {
        return createLease(ownerDirectory, recordName, record);
      }
      const existing = await readOwners(ownerDirectory);
      if (!existing) continue;
      const liveOwner = await findLiveOwner(existing, dependencies);
      if (liveOwner) throw ownerBusyError(liveOwner.pid);
      if (!(await removeStaleOwnerDirectory(ownerDirectory, existing))) {
        continue;
      }
    }
    throw ownerBusyError();
  } finally {
    await unlink(temporaryRecord).catch(() => undefined);
    await rmdir(temporaryDirectory).catch(() => undefined);
  }
}

async function publishOwner(
  temporaryDirectory: string,
  ownerDirectory: string
): Promise<boolean> {
  try {
    await rename(temporaryDirectory, ownerDirectory);
    return true;
  } catch (error) {
    if (isPublishConflict(error)) return false;
    throw error;
  }
}

function createLease(
  ownerDirectory: string,
  recordName: string,
  record: OwnerRecord
): SessiondOwnerLease {
  const recordPath = join(ownerDirectory, recordName);
  let released = false;
  return {
    path: recordPath,
    pid: record.pid,
    nonce: record.nonce,
    release: async () => {
      if (released) return;
      const current = await readOwnerFile(ownerDirectory, recordName);
      if (
        !current?.record ||
        current.record.pid !== record.pid ||
        current.record.nonce !== record.nonce
      ) {
        released = true;
        return;
      }
      await removeOwnerFileIfUnchanged(ownerDirectory, current);
      await removeEmptyDirectory(ownerDirectory);
      released = true;
    }
  };
}

async function readOwners(path: string): Promise<OwnerSnapshot[] | null> {
  let names: string[];
  try {
    names = await readdir(path);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null;
    throw error;
  }
  return await Promise.all(
    names.map(async (name) => {
      const snapshot = await readOwnerFile(path, name);
      return snapshot ?? { name, raw: "", record: null };
    })
  );
}

async function readOwnerFile(
  ownerDirectory: string,
  name: string
): Promise<OwnerSnapshot | null> {
  try {
    const raw = await readFile(join(ownerDirectory, basename(name)), "utf8");
    const record = parseOwner(raw);
    return {
      name,
      raw,
      record: record && ownerRecordName(record) === name ? record : null
    };
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return null;
    return { name, raw: "", record: null };
  }
}

async function findLiveOwner(
  owners: OwnerSnapshot[],
  dependencies: OwnerLeaseDependencies
): Promise<OwnerRecord | null> {
  for (const owner of owners) {
    if (
      owner.record &&
      (await dependencies.isProcessAlive(owner.record.pid))
    ) {
      return owner.record;
    }
  }
  return null;
}

async function removeStaleOwnerDirectory(
  ownerDirectory: string,
  owners: OwnerSnapshot[]
): Promise<boolean> {
  for (const owner of owners) {
    if (!(await removeOwnerFileIfUnchanged(ownerDirectory, owner))) {
      return false;
    }
  }
  return await removeEmptyDirectory(ownerDirectory);
}

async function removeOwnerFileIfUnchanged(
  ownerDirectory: string,
  expected: OwnerSnapshot
): Promise<boolean> {
  const current = await readOwnerFile(ownerDirectory, expected.name);
  if (!current) return true;
  if (current.raw !== expected.raw) return false;
  try {
    await unlink(join(ownerDirectory, basename(expected.name)));
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return true;
    return false;
  }
}

async function removeEmptyDirectory(path: string): Promise<boolean> {
  try {
    await rmdir(path);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return true;
    if (
      ["EEXIST", "ENOTEMPTY", "EPERM"].includes(nodeErrorCode(error) ?? "")
    ) {
      return false;
    }
    throw error;
  }
}

function ownerRecordName(record: Pick<OwnerRecord, "pid" | "nonce">): string {
  return `owner-${createHash("sha256")
    .update(`${record.pid}:${record.nonce}`)
    .digest("hex")}.json`;
}

function parseOwner(raw: string): OwnerRecord | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== ownerLeaseVersion ||
      typeof value.pid !== "number" ||
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      typeof value.nonce !== "string" ||
      !value.nonce ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))
    ) {
      return null;
    }
    return {
      version: ownerLeaseVersion,
      pid: value.pid,
      nonce: value.nonce,
      createdAt: value.createdAt
    };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === "ESRCH") return false;
    return true;
  }
}

function isPublishConflict(error: unknown): boolean {
  return ["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"].includes(
    nodeErrorCode(error) ?? ""
  );
}

function ownerBusyError(pid?: number): PiWebError {
  return new PiWebError(
    "SESSIOND_OWNER_BUSY",
    pid
      ? `Session daemon data is owned by process ${pid}`
      : "Session daemon data is already owned by another process",
    503
  );
}

function nodeErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : null;
}
