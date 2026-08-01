import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiWebPaths } from "@pi-web/config";
import { describe, expect, it } from "vitest";
import { SessionDatabase } from "./database.js";
import { SessionFolderStore } from "./session-folders.js";

describe("Sessiond conversation folders", () => {
  it("stores folder metadata beside the authoritative session index", async () => {
    const { db, paths } = await fixture();
    const session = db.createSession({
      cwd: paths.dataDir,
      displayName: "Session",
      createdBy: "web"
    });
    const store = new SessionFolderStore(db, paths);
    await store.initialize();

    const created = store.create({ name: "客户端" });
    const folder = created.folders[0]!;
    const assigned = store.assign(session.id, { folderId: folder.id });
    expect(assigned.assignments[session.id]).toBe(folder.id);

    const reopened = new SessionFolderStore(db, paths);
    await reopened.initialize();
    expect(reopened.get()).toEqual(assigned);
    db.close();
  });

  it("migrates the legacy server JSON once without deleting it", async () => {
    const { db, paths } = await fixture();
    const folderId = "2fb9d8d6-156e-4949-8d9f-1debd9cb9349";
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(
      join(paths.configDir, "session-folders.json"),
      JSON.stringify({
        folders: [
          {
            id: folderId,
            name: "旧分组",
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        assignments: {}
      })
    );

    const store = new SessionFolderStore(db, paths);
    await store.initialize();
    expect(store.get().folders).toEqual([
      {
        id: folderId,
        name: "旧分组",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]);

    await writeFile(
      join(paths.configDir, "session-folders.json"),
      JSON.stringify({ folders: [], assignments: {} })
    );
    await store.initialize();
    expect(store.get().folders).toHaveLength(1);
    db.close();
  });

  it("rejects assignments for sessions outside Sessiond's index", async () => {
    const { db, paths } = await fixture();
    const store = new SessionFolderStore(db, paths);
    await store.initialize();
    const folder = store.create({ name: "待处理" }).folders[0]!;

    expect(() =>
      store.assign("fb4ae798-5fc6-4e0f-9538-487042c63e75", {
        folderId: folder.id
      })
    ).toThrow("Session not found");
    db.close();
  });

  it("renames uniquely and removes the folder's assignments", async () => {
    const { db, paths } = await fixture();
    const firstSession = db.createSession({
      cwd: paths.dataDir,
      displayName: "First",
      createdBy: "web"
    });
    const store = new SessionFolderStore(db, paths);
    await store.initialize();
    const first = store.create({ name: "后端" }).folders[0]!;
    store.create({ name: "前端" });
    store.assign(firstSession.id, { folderId: first.id });

    expect(() => store.rename(first.id, { name: "前端" })).toThrow(
      "already exists"
    );
    expect(store.rename(first.id, { name: "服务端" }).folders[0]?.name).toBe(
      "服务端"
    );
    expect(store.remove(first.id)).toMatchObject({
      assignments: {},
      folders: [{ name: "前端" }]
    });
    db.close();
  });

  it("isolates invalid legacy metadata instead of blocking Sessiond startup", async () => {
    const { db, paths } = await fixture();
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(
      join(paths.configDir, "session-folders.json"),
      "{not valid json"
    );
    const store = new SessionFolderStore(db, paths);

    await expect(store.initialize()).resolves.toBeUndefined();
    expect(() => store.get()).toThrowError(
      expect.objectContaining({ code: "SESSION_FOLDERS_INVALID" })
    );
    expect(
      db.createSession({
        cwd: paths.dataDir,
        displayName: "Still available",
        createdBy: "web"
      }).displayName
    ).toBe("Still available");
    db.close();
  });

  it("isolates legacy file read failures instead of blocking Sessiond startup", async () => {
    const { db, paths } = await fixture();
    await mkdir(paths.configDir, { recursive: true });
    await mkdir(join(paths.configDir, "session-folders.json"));
    const store = new SessionFolderStore(db, paths);

    await expect(store.initialize()).resolves.toBeUndefined();
    expect(() => store.get()).toThrowError(
      expect.objectContaining({ code: "SESSION_FOLDERS_INVALID" })
    );
    expect(
      db.createSession({
        cwd: paths.dataDir,
        displayName: "Still available",
        createdBy: "web"
      }).displayName
    ).toBe("Still available");
    db.close();
  });

  it("rejects duplicate persisted folder IDs", async () => {
    const { db, paths } = await fixture();
    const folderId = "2fb9d8d6-156e-4949-8d9f-1debd9cb9349";
    db.setSetting("session_folders_v1", {
      folders: [
        {
          id: folderId,
          name: "First",
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: folderId,
          name: "Duplicate",
          createdAt: "2026-01-02T00:00:00.000Z"
        }
      ],
      assignments: {}
    });
    const store = new SessionFolderStore(db, paths);

    await expect(store.initialize()).resolves.toBeUndefined();
    expect(() => store.get()).toThrowError(
      expect.objectContaining({ code: "SESSION_FOLDERS_INVALID" })
    );
    db.close();
  });

  it("rejects persisted assignments to missing folders or sessions", async () => {
    const missingSessionId = "fb4ae798-5fc6-4e0f-9538-487042c63e75";
    const folderId = "2fb9d8d6-156e-4949-8d9f-1debd9cb9349";

    const assignmentCases: Array<Record<string, string>> = [
      {
        [missingSessionId]: "2a9ee3a1-5a4e-44e0-844b-f94cde47af15"
      },
      { [missingSessionId]: folderId }
    ];
    for (const assignments of assignmentCases) {
      const { db, paths } = await fixture();
      if (assignments[missingSessionId] !== folderId) {
        db.createSession({
          cwd: paths.dataDir,
          displayName: "Indexed session",
          createdBy: "web",
          piSessionReference: null
        });
        const indexed = db.listSessions()[0]!;
        assignments[indexed.id] = assignments[missingSessionId]!;
        delete assignments[missingSessionId];
      }
      db.setSetting("session_folders_v1", {
        folders: [
          {
            id: folderId,
            name: "Folder",
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        assignments
      });
      const store = new SessionFolderStore(db, paths);

      await expect(store.initialize()).resolves.toBeUndefined();
      expect(() => store.get()).toThrowError(
        expect.objectContaining({ code: "SESSION_FOLDERS_INVALID" })
      );
      db.close();
    }
  });
});

async function fixture(): Promise<{
  db: SessionDatabase;
  paths: PiWebPaths;
}> {
  const base = await mkdtemp(join(tmpdir(), "pi-web-session-folders-"));
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  const paths: PiWebPaths = {
    configDir,
    configFile: join(configDir, "config.json"),
    dataDir,
    cacheDir: join(base, "cache"),
    databaseFile: join(dataDir, "pi-web.sqlite"),
    socketPath: join(base, "sessiond.sock"),
    ipcTokenFile: join(dataDir, "runtime", "ipc-server-token"),
    runtimeDir: join(dataDir, "runtime")
  };
  return {
    db: new SessionDatabase(paths.databaseFile),
    paths
  };
}
