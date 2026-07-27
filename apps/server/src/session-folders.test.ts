import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PiWebPaths } from "@pi-web/config";
import { SessionFolderStore } from "./session-folders.js";

let root = "";
let store: SessionFolderStore;

beforeEach(async () => {
  const testRoot = resolve(process.cwd(), ".runtime/tests");
  await mkdir(testRoot, { recursive: true });
  root = await mkdtemp(join(testRoot, "session-folders-"));
  store = new SessionFolderStore(testPaths(root));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("SessionFolderStore", () => {
  it("creates folders and assigns sessions", async () => {
    const created = await store.create({ name: "客户端" });
    const folder = created.folders[0]!;
    const sessionId = "8e9fe51a-4c88-4fbf-baaa-fd6b38e8f306";

    const assigned = await store.assign(sessionId, { folderId: folder.id });
    expect(assigned.assignments[sessionId]).toBe(folder.id);
    expect((await store.get()).folders[0]?.name).toBe("客户端");
  });

  it("removes assignments when a folder is deleted", async () => {
    const folder = (await store.create({ name: "待处理" })).folders[0]!;
    const sessionId = "fb4ae798-5fc6-4e0f-9538-487042c63e75";
    await store.assign(sessionId, { folderId: folder.id });

    const removed = await store.remove(folder.id);
    expect(removed.folders).toEqual([]);
    expect(removed.assignments).toEqual({});
  });

  it("rejects duplicate names", async () => {
    await store.create({ name: "后端" });
    await expect(store.create({ name: "后端" })).rejects.toMatchObject({
      code: "SESSION_FOLDER_EXISTS"
    });
  });
});

function testPaths(base: string): PiWebPaths {
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  return {
    configDir,
    configFile: join(configDir, "config.json"),
    dataDir,
    cacheDir: join(base, "cache"),
    databaseFile: join(dataDir, "pi-web.sqlite"),
    socketPath: join(base, "sessiond.sock"),
    ipcTokenFile: join(dataDir, "runtime", "ipc-server-token"),
    runtimeDir: join(dataDir, "runtime")
  };
}
