import {
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
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

  it("reuses an attachment mutation only for identical input", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-attachment-"));
    const mutationId = "7f0697ba-1428-4703-bca7-6df506585324";
    const [first, retried] = await Promise.all([
      saveAttachment(cwd, "notes.txt", Buffer.from("hello"), mutationId),
      saveAttachment(cwd, "notes.txt", Buffer.from("hello"), mutationId)
    ]);

    expect(retried).toEqual(first);
    expect(
      (await readdir(join(cwd, ".pi-web", "attachments"))).filter((name) =>
        name.startsWith(".pi-web-upload-")
      )
    ).toEqual([]);
    await expect(
      saveAttachment(cwd, "notes.txt", Buffer.from("changed"), mutationId)
    ).rejects.toMatchObject({ code: "MUTATION_ID_REUSED", statusCode: 409 });
    await expect(
      saveAttachment(cwd, "other.txt", Buffer.from("hello"), mutationId)
    ).rejects.toMatchObject({ code: "MUTATION_ID_REUSED", statusCode: 409 });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink planted at an idempotent attachment path",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "pi-web-attachment-"));
      const mutationId = "ba9503a9-6341-46bf-ae49-a9cd9efceab7";
      const first = await saveAttachment(
        cwd,
        "notes.txt",
        Buffer.from("hello"),
        mutationId
      );
      const target = join(cwd, first.path);
      const outside = join(await mkdtemp(join(tmpdir(), "pi-web-outside-")), "notes.txt");
      await writeFile(outside, "hello");
      await unlink(target);
      await symlink(outside, target, "file");

      await expect(
        saveAttachment(cwd, "notes.txt", Buffer.from("hello"), mutationId)
      ).rejects.toMatchObject({
        code: "MUTATION_ID_REUSED",
        statusCode: 409
      });
    }
  );
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

  it("atomically rejects concurrent file renames to the same target", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-files-"));
    await writeFile(join(cwd, "first.txt"), "first");
    await writeFile(join(cwd, "second.txt"), "second");

    const results = await Promise.allSettled([
      renameWorkspaceEntry(cwd, "first.txt", "winner.txt"),
      renameWorkspaceEntry(cwd, "second.txt", "winner.txt")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find((result) => result.status === "rejected");
    expect(rejection).toMatchObject({
      reason: { code: "ENTRY_ALREADY_EXISTS", statusCode: 409 }
    });
    const remaining = await Promise.all(
      ["first.txt", "second.txt", "winner.txt"].map(async (name) =>
        await readFile(join(cwd, name), "utf8").catch(() => null)
      )
    );
    expect(remaining.filter(Boolean).sort()).toEqual(["first", "second"]);
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
