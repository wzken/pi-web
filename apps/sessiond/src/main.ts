#!/usr/bin/env node
import { ensureDirectories, loadConfig, resolvePaths } from "@pi-web/config";
import { safeErrorMessage } from "@pi-web/shared";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionDatabase } from "./database.js";
import { IpcServer } from "./ipc-server.js";
import { PiManager } from "./pi-manager.js";
import { Scheduler } from "./scheduler.js";
import { SessionSupervisor } from "./supervisor.js";

export async function runSessiond(): Promise<{
  close: () => Promise<void>;
}> {
  const paths = resolvePaths();
  await ensureDirectories(paths);
  const config = await loadConfig();
  const db = new SessionDatabase(paths.databaseFile);
  const interrupted = db.markOrphanedSessionsInterrupted();
  const interruptedRuns = db.markOrphanedRunsFailed();
  const supervisor = new SessionSupervisor(db, config, paths);
  const piManager = new PiManager(config, db);
  const scheduler = new Scheduler(db, supervisor, piManager, config);
  const ipc = new IpcServer({
    paths,
    config,
    db,
    supervisor,
    scheduler,
    piManager
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

  let closing = false;
  return {
    close: async () => {
      if (closing) return;
      closing = true;
      scheduler.stop();
      await supervisor.shutdown();
      await ipc.stop();
      db.close();
    }
  };
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
