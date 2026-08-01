#!/usr/bin/env node
import { ensureDirectories, loadConfig, resolvePaths } from "@pi-web/config";
import { safeErrorMessage } from "@pi-web/shared";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionDatabase } from "./database.js";
import { IpcServer } from "./ipc-server.js";
import { acquireSessiondOwnerLease } from "./owner-lease.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { SessionFolderStore } from "./session-folders.js";
import { SessionSupervisor } from "./supervisor.js";

export async function runSessiond(): Promise<{
  close: () => Promise<void>;
}> {
  const paths = resolvePaths();
  await ensureDirectories(paths);
  const owner = await acquireSessiondOwnerLease(paths);
  let db: SessionDatabase | null = null;
  let supervisor: SessionSupervisor | null = null;
  let scheduler: Scheduler | null = null;
  let ipc: IpcServer | null = null;
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = () => {
    cleanupPromise ??= cleanupSessiondResources({
      owner,
      get db() {
        return db;
      },
      clearDb() {
        db = null;
      },
      get supervisor() {
        return supervisor;
      },
      get scheduler() {
        return scheduler;
      },
      get ipc() {
        return ipc;
      }
    });
    return cleanupPromise;
  };
  try {
    const config = await loadConfig();
    db = new SessionDatabase(paths.databaseFile);
    const interrupted = db.markOrphanedSessionsInterrupted();
    const interruptedRuns = db.markOrphanedRunsFailed();
    supervisor = new SessionSupervisor(db, config, paths);
    const piManager = new PiManager(config, db);
    scheduler = new Scheduler(db, supervisor, config);
    const sessionFolders = new SessionFolderStore(db, paths);
    await sessionFolders.initialize();
    ipc = new IpcServer({
      paths,
      config,
      db,
      supervisor,
      scheduler,
      piManager,
      sessionFolders
    });
    await ipc.start();
    scheduler.start();
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        message: "pi-web-sessiond ready",
        socket: paths.socketPath,
        interruptedSessions: interrupted,
        interruptedRuns
      })}\n`
    );

    return {
      close: cleanup
    };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Sessiond startup failed and its resources could not be fully released"
      );
    }
    throw error;
  }
}

interface SessiondCleanupResources {
  readonly owner: Awaited<ReturnType<typeof acquireSessiondOwnerLease>>;
  readonly db: SessionDatabase | null;
  readonly supervisor: SessionSupervisor | null;
  readonly scheduler: Scheduler | null;
  readonly ipc: IpcServer | null;
  clearDb(): void;
}

async function cleanupSessiondResources(
  resources: SessiondCleanupResources
): Promise<void> {
  let failure: unknown = null;
  const capture = (error: unknown) => {
    failure ??= error;
  };
  try {
    resources.scheduler?.stop();
  } catch (error) {
    capture(error);
  }
  try {
    await resources.ipc?.stop();
  } catch (error) {
    capture(error);
  }
  try {
    await resources.scheduler?.shutdown();
  } catch (error) {
    capture(error);
  }
  try {
    await resources.supervisor?.shutdown();
  } catch (error) {
    capture(error);
  }
  try {
    resources.db?.close();
    resources.clearDb();
  } catch (error) {
    capture(error);
  }
  if (failure) throw failure;
  await resources.owner.release();
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runSessiond()
    .then((runtime) => {
      const shutdown = () => {
        void runtime.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          message: "sessiond failed",
          error: safeErrorMessage(error)
        })}\n`
      );
      process.exitCode = 1;
    });
}
