import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeSessionWorkspace,
  createWorkspaceEntry,
  renameWorkspaceEntry,
  sanitizeAttachmentName,
  saveAttachment,
  validateWorkspaceEntryName
} from "./files.js";

describe("session workspace authorization", () => {
  it("revokes file access when the configured roots are tightened", async () => {
    const originalRoot = await mkdtemp(join(tmpdir(), "pi-web-original-root-"));
    const tightenedRoot = await mkdtemp(join(tmpdir(), "pi-web-tight-root-"));

    expect(
      await authorizeSessionWorkspace(
        { cwd: originalRoot },
        { allowedRoots: [originalRoot], allowAnyDirectory: false }
      )
    ).toBe(originalRoot);
    await expect(
      authorizeSessionWorkspace(
        { cwd: originalRoot },
        { allowedRoots: [tightenedRoot], allowAnyDirectory: false }
      )
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_ROOTS" });
  });
});

describe("file attachments", () => {
  it("stores uploads in the controlled workspace attachment directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-attachment-"));
    const result = await saveAttachment(
      cwd,
      "../审查 notes?.txt",
      Buffer.from("hello")
    );

    expect(result.path).toMatch(
      /^\.pi-web\/attachments\/[a-f0-9]{8}-审查-notes-.txt$/
    );
    expect(await readFile(join(cwd, result.path), "utf8")).toBe("hello");
  });

  it("removes path separators and unsafe filename characters", () => {
    expect(sanitizeAttachmentName("../../a:b?.log")).toBe("a-b-.log");
    expect(sanitizeAttachmentName("...")).toBe("attachment");
  });
});

describe("workspace file mutations", () => {
  it("creates files and directories inside the requested workspace folder", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-files-"));
    await createWorkspaceEntry(cwd, "", "notes.md", false);
    await createWorkspaceEntry(cwd, "", "docs", true);
    await createWorkspaceEntry(cwd, "docs", "guide.md", false);

    expect(await readFile(join(cwd, "notes.md"), "utf8")).toBe("");
    expect((await stat(join(cwd, "docs"))).isDirectory()).toBe(true);
    expect(await readFile(join(cwd, "docs", "guide.md"), "utf8")).toBe("");
  });

  it("renames an entry without changing file contents", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-files-"));
    await writeFile(join(cwd, "draft.txt"), "preserved");

    const result = await renameWorkspaceEntry(
      cwd,
      "draft.txt",
      "finished.txt"
    );

    expect(result).toEqual({
      path: "finished.txt",
      name: "finished.txt",
      directory: false
    });
    expect(await readFile(join(cwd, "finished.txt"), "utf8")).toBe("preserved");
  });

  it("never overwrites an existing entry", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-files-"));
    await writeFile(join(cwd, "source.txt"), "source");
    await writeFile(join(cwd, "target.txt"), "target");

    await expect(
      createWorkspaceEntry(cwd, "", "target.txt", false)
    ).rejects.toMatchObject({ code: "ENTRY_ALREADY_EXISTS" });
    await expect(
      renameWorkspaceEntry(cwd, "source.txt", "target.txt")
    ).rejects.toMatchObject({ code: "ENTRY_ALREADY_EXISTS" });
    expect(await readFile(join(cwd, "target.txt"), "utf8")).toBe("target");
  });

  it("rejects traversal, reserved names and overlong names", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-files-"));

    expect(() => validateWorkspaceEntryName("../outside")).toThrow();
    expect(() => validateWorkspaceEntryName("CON.txt")).toThrow();
    expect(() => validateWorkspaceEntryName("x".repeat(241))).toThrow();
    await expect(
      createWorkspaceEntry(cwd, "..", "outside.txt", false)
    ).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    await expect(
      renameWorkspaceEntry(cwd, ".", "moved-workspace")
    ).rejects.toMatchObject({ code: "WORKSPACE_ROOT_MUTATION_FORBIDDEN" });
  });
});
