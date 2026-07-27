import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const runtimeParent = join(workspace, ".runtime", "e2e");
await mkdir(runtimeParent, { recursive: true });
const runtimeRoot = await mkdtemp(join(runtimeParent, "run-"));

Object.assign(process.env, {
  NODE_ENV: "production",
  PI_WEB_HOST: "127.0.0.1",
  PI_WEB_PORT: process.env.PI_WEB_E2E_PORT || "8787",
  PI_WEB_DATA_DIR: join(runtimeRoot, "data"),
  PI_WEB_CONFIG_DIR: join(runtimeRoot, "config"),
  PI_WEB_CACHE_DIR: join(runtimeRoot, "cache"),
  PI_WEB_ALLOWED_ROOTS: workspace,
  PI_WEB_ALLOW_ANY_DIRECTORY: "false",
  PI_WEB_ACCESS_KEY: "pi-web-e2e-access",
  PI_WEB_FAKE_PI: join(workspace, "tests", "fixtures", "fake-pi.mjs"),
  PI_WEB_LOG_LEVEL: "warn"
});

const [{ runSessiond }, { runServer }] = await Promise.all([
  import("../../apps/sessiond/dist/main.js"),
  import("../../apps/server/dist/main.js")
]);
const sessiond = await runSessiond();
const server = await runServer();

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close().catch(() => undefined);
  await sessiond.close().catch(() => undefined);
  await rm(runtimeRoot, { recursive: true, force: true }).catch(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void close().finally(() => process.exit(0));
  });
}

await new Promise(() => {});
