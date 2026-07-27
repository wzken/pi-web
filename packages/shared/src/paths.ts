import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { PiWebError } from "./errors.js";

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
}

export async function resolveAllowedDirectory(
  input: string,
  allowedRoots: string[],
  allowAnyDirectory = false
): Promise<string> {
  const target = await realpath(resolve(input)).catch(() => {
    throw new PiWebError("PATH_NOT_FOUND", "Directory does not exist", 400);
  });
  const info = await stat(target);
  if (!info.isDirectory()) {
    throw new PiWebError("NOT_A_DIRECTORY", "Path is not a directory", 400);
  }
  await access(target, constants.R_OK | constants.X_OK).catch(() => {
    throw new PiWebError("PATH_NOT_ACCESSIBLE", "Directory is not accessible", 403);
  });
  if (allowAnyDirectory) return target;

  const roots = await Promise.all(
    allowedRoots.map(async (root) => realpath(resolve(root)).catch(() => null))
  );
  if (!roots.some((root) => root !== null && isWithin(root, target))) {
    throw new PiWebError("PATH_OUTSIDE_ROOTS", "Path is outside allowed roots", 403);
  }
  return target;
}

export async function resolveContainedPath(
  root: string,
  relativePath: string
): Promise<string> {
  if (relativePath.includes("\0")) {
    throw new PiWebError("INVALID_PATH", "Path contains invalid characters", 400);
  }
  const realRoot = await realpath(root);
  const candidate = resolve(realRoot, relativePath || ".");
  const target = await realpath(candidate).catch(() => {
    throw new PiWebError("PATH_NOT_FOUND", "File or directory does not exist", 404);
  });
  if (!isWithin(realRoot, target)) {
    throw new PiWebError("PATH_ESCAPE", "Path escapes the session directory", 403);
  }
  return target;
}
