#!/usr/bin/env node
import { loadConfig, resolvePaths } from "@pi-web/config";
import { safeErrorMessage } from "@pi-web/shared";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./app.js";
import { AuthManager } from "./auth.js";
import { PushService } from "./push-service.js";
import { SessiondClient } from "@pi-web/ipc";

export async function runServer(): Promise<{ close: () => Promise<void> }> {
  const config = await loadConfig();
  const paths = resolvePaths();
  const client = new SessiondClient(paths.socketPath, paths.ipcTokenFile);
  await client.start();
  const auth = new AuthManager(client);
  const { generatedKey } = await auth.initialize();
  const push = new PushService(client);
  await push.start();
  let app;
  try {
    app = await createServer({ config, paths, client, auth, push });
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    push.stop();
    client.stop();
    throw error;
  }

  if (generatedKey) {
    if (process.stdout.isTTY) {
      process.stdout.write(
        "\nPi Web access key (shown once):\n" +
          `${generatedKey}\n\n` +
          "Store it securely. Run `pi-web reset-key` to replace it.\n"
      );
    } else {
      app.log.warn(
        "An access key was generated but was not written to non-interactive logs. Run `pi-web reset-key` from a terminal."
      );
    }
  }
  if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) {
    app.log.warn(
      "Pi Web is listening beyond loopback. Plain HTTP is unencrypted; use a trusted private network or HTTPS reverse proxy."
    );
  }
  return {
    close: async () => {
      push.stop();
      await app.close();
      client.stop();
    }
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  runServer()
    .then((runtime) => {
      const shutdown = () => {
        void runtime.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch((error) => {
      process.stderr.write(`pi-web-server failed: ${safeErrorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
