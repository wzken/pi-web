import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAllowedDirectory, resolveContainedPath } from "./paths.js";

describe("path containment", () => {
  it("accepts a real child and rejects traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-path-"));
    const child = join(root, "project");
    await mkdir(child);
    await writeFile(join(child, "ok.txt"), "ok");
    expect(await resolveAllowedDirectory(child, [root])).toBe(child);
    await expect(resolveContainedPath(child, "../")).rejects.toMatchObject({
      code: "PATH_ESCAPE"
    });
  });

  it("rejects a symlink that escapes the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-root-"));
    const outside = await mkdtemp(join(tmpdir(), "pi-web-outside-"));
    const link = join(root, "escape");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await expect(resolveContainedPath(root, "escape")).rejects.toMatchObject({
      code: "PATH_ESCAPE"
    });
  });
});
