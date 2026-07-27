#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { ensureDirectories, loadConfig, resolvePaths, saveConfig } from "@pi-web/config";
import { SessiondClient } from "@pi-web/server";
import { PiManager, SessionDatabase } from "@pi-web/sessiond";
import {
  generateAccessKey,
  hashAccessKey,
  safeErrorMessage
} from "@pi-web/shared";
import {
  confirmAccessKeyInput,
  readAccessKeyFromStdin,
  readMaskedAccessKey,
  validateAccessKeyInput
} from "./access-key-input.js";
import { prepareInstalledAccessKey } from "./install-access-key.js";

const execFileAsync = promisify(execFile);
const VERSION = "0.1.0";
const command = process.argv[2] ?? "help";

async function main(): Promise<void> {
  switch (command) {
    case "start":
      await startCombined();
      return;
    case "server": {
      const { runServer } = await import("@pi-web/server");
      const runtime = await runServer();
      installSignalHandlers(runtime.close);
      return;
    }
    case "sessiond": {
      const { runSessiond } = await import("@pi-web/sessiond");
      const runtime = await runSessiond();
      installSignalHandlers(runtime.close);
      return;
    }
    case "install":
      await install();
      return;
    case "uninstall":
      await uninstall();
      return;
    case "status":
      await status();
      return;
    case "doctor":
      await doctor();
      return;
    case "reset-key":
      await resetKey();
      return;
    case "set-password":
    case "set-key":
      await setPassword();
      return;
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(`Pi Web ${VERSION}\n`);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run pi-web help.`);
  }
}

async function startCombined(): Promise<void> {
  const cli = fileURLToPath(import.meta.url);
  const sessiond = spawn(process.execPath, [cli, "sessiond"], {
    stdio: "inherit",
    env: process.env,
    windowsHide: true
  });
  const paths = resolvePaths();
  await waitForSocket(paths.socketPath, 15_000);
  const server = spawn(process.execPath, [cli, "server"], {
    stdio: "inherit",
    env: process.env,
    windowsHide: true
  });
  const stop = () => {
    server.kill("SIGTERM");
    sessiond.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => sessiond.once("exit", () => resolve()))
  ]);
  stop();
}

async function install(): Promise<void> {
  if (platform() !== "linux") {
    throw new Error("pi-web install currently supports Linux systemd user services only.");
  }
  const paths = resolvePaths();
  await ensureDirectories(paths);
  const config = await loadConfig();
  try {
    await access(paths.configFile, constants.F_OK);
  } catch {
    await saveConfig(config, paths);
  }
  const db = new SessionDatabase(paths.databaseFile);
  let generatedKey: string | null;
  try {
    ({ generatedKey } = await prepareInstalledAccessKey(
      db,
      process.env.PI_WEB_ACCESS_KEY
    ));
  } finally {
    db.close();
  }

  const unitDir = join(homedir(), ".config", "systemd", "user");
  await mkdir(unitDir, { recursive: true, mode: 0o700 });
  const cli = fileURLToPath(import.meta.url);
  const node = process.execPath;
  const sessionUnit = renderUnit("sessiond", node, cli);
  const serverUnit = renderUnit("server", node, cli);
  await writePrivate(join(unitDir, "pi-web-sessiond.service"), sessionUnit);
  await writePrivate(join(unitDir, "pi-web-server.service"), serverUnit);
  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", [
    "--user",
    "enable",
    "--now",
    "pi-web-sessiond.service",
    "pi-web-server.service"
  ]);

  process.stdout.write(`Pi Web installed and started at http://${displayHost(config.host)}:${config.port}\n`);
  if (generatedKey) {
    process.stdout.write(`\nAccess key (shown once):\n${generatedKey}\n\n`);
  }
  process.stdout.write(
    "For service continuity after logout, an administrator may run:\n" +
      `  loginctl enable-linger ${process.env.USER ?? "<user>"}\n` +
      "Pi Web does not run sudo or change firewall, VPN, TLS, or linger settings.\n" +
      "Do not expose plain HTTP to an untrusted network.\n"
  );
}

async function uninstall(): Promise<void> {
  if (platform() !== "linux") {
    throw new Error("pi-web uninstall currently supports Linux systemd user services only.");
  }
  await execFileAsync("systemctl", [
    "--user",
    "disable",
    "--now",
    "pi-web-server.service",
    "pi-web-sessiond.service"
  ]).catch(() => undefined);
  const unitDir = join(homedir(), ".config", "systemd", "user");
  await rm(join(unitDir, "pi-web-server.service"), { force: true });
  await rm(join(unitDir, "pi-web-sessiond.service"), { force: true });
  await execFileAsync("systemctl", ["--user", "daemon-reload"]).catch(() => undefined);
  process.stdout.write(
    "Pi Web user services were removed. Configuration, database, schedules, and session mappings were preserved.\n"
  );
}

async function status(): Promise<void> {
  const config = await loadConfig();
  if (platform() === "linux") {
    for (const unit of ["pi-web-sessiond.service", "pi-web-server.service"]) {
      const result = await execFileAsync("systemctl", [
        "--user",
        "is-active",
        unit
      ]).catch((error) => ({
        stdout: "",
        stderr: safeErrorMessage(error)
      }));
      process.stdout.write(`${unit.padEnd(30)} ${result.stdout.trim() || "inactive"}\n`);
    }
  }
  process.stdout.write(`Address: http://${displayHost(config.host)}:${config.port}\n`);
}

async function doctor(): Promise<void> {
  const paths = resolvePaths();
  const config = await loadConfig();
  const checks: Array<[string, "PASS" | "WARN" | "FAIL", string]> = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push([
    "Node.js",
    nodeMajor >= 22 ? "PASS" : "FAIL",
    process.versions.node
  ]);
  await ensureDirectories(paths)
    .then(() => checks.push(["XDG directories", "PASS", paths.dataDir]))
    .catch((error) => checks.push(["XDG directories", "FAIL", safeErrorMessage(error)]));
  await access(paths.configFile, constants.R_OK)
    .then(() => checks.push(["Config readable", "PASS", paths.configFile]))
    .catch((error: NodeJS.ErrnoException) =>
      checks.push([
        "Config readable",
        error.code === "ENOENT" ? "WARN" : "FAIL",
        error.code === "ENOENT" ? "using defaults; no config file yet" : safeErrorMessage(error)
      ])
    );
  for (const [name, directory] of [
    ["Config permissions", paths.configDir],
    ["Data permissions", paths.dataDir]
  ] as const) {
    await stat(directory)
      .then((info) => {
        const openBits = info.mode & 0o077;
        checks.push([
          name,
          platform() === "win32" || openBits === 0 ? "PASS" : "WARN",
          platform() === "win32"
            ? directory
            : `${directory} mode ${(info.mode & 0o777).toString(8)}`
        ]);
      })
      .catch((error) => checks.push([name, "FAIL", safeErrorMessage(error)]));
  }

  let db: SessionDatabase | null = null;
  try {
    db = new SessionDatabase(paths.databaseFile);
    checks.push(["SQLite", "PASS", paths.databaseFile]);
    const probe = await new PiManager(config, db).doctorProbe();
    checks.push([
      "Pi",
      probe.available ? "PASS" : "FAIL",
      probe.version ?? probe.errors[0] ?? config.piExecutable
    ]);
    checks.push([
      "Pi RPC",
      probe.rpcStartable ? "PASS" : "FAIL",
      probe.rpcStartable ? "get_state handshake succeeded" : probe.errors.join("; ")
    ]);
    checks.push([
      "Package commands",
      probe.packageCommands ? "PASS" : "FAIL",
      probe.packageCommands ? "pi list succeeded" : probe.errors.join("; ")
    ]);
  } catch (error) {
    checks.push(["SQLite / Pi probe", "FAIL", safeErrorMessage(error)]);
  } finally {
    db?.close();
  }

  const piConfigDir =
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  await access(piConfigDir, constants.R_OK)
    .then(() => checks.push(["Pi config readable", "PASS", piConfigDir]))
    .catch(() => checks.push(["Pi config readable", "WARN", `${piConfigDir} not found or unreadable`]));

  const socketReady = await canConnect(paths.socketPath).catch(() => false);
  checks.push([
    "Session daemon socket",
    socketReady ? "PASS" : "FAIL",
    paths.socketPath
  ]);
  if (socketReady) {
    const client = new SessiondClient(paths.socketPath, paths.ipcTokenFile);
    try {
      await client.start();
      const result = await client.request<{
        scheduler?: boolean;
        activeWorkers?: number;
      }>("doctor", undefined, 30_000);
      checks.push([
        "Cron scheduler",
        result.scheduler ? "PASS" : "FAIL",
        `${result.activeWorkers ?? 0} active workers`
      ]);
    } catch (error) {
      checks.push(["Cron scheduler", "FAIL", safeErrorMessage(error)]);
    } finally {
      client.stop();
    }
  }

  const diagnosticHost =
    config.host === "::1"
      ? "[::1]"
      : ["0.0.0.0", "::"].includes(config.host)
        ? "127.0.0.1"
        : config.host;
  const healthUrl = `http://${diagnosticHost}:${config.port}/api/health`;
  await fetch(healthUrl, { signal: AbortSignal.timeout(3000) })
    .then(async (response) => {
      checks.push([
        "Web server",
        response.ok ? "PASS" : "FAIL",
        `${healthUrl} returned ${response.status}`
      ]);
    })
    .catch(async (error) => {
      const occupied = await canConnectTcp(
        diagnosticHost.replaceAll("[", "").replaceAll("]", ""),
        config.port
      );
      checks.push([
        "Web server",
        occupied ? "WARN" : "FAIL",
        occupied ? `port ${config.port} is occupied by another service` : safeErrorMessage(error)
      ]);
    });

  if (platform() === "linux") {
    for (const unit of ["pi-web-sessiond.service", "pi-web-server.service"]) {
      const active = await execFileAsync("systemctl", [
        "--user",
        "is-active",
        unit
      ])
        .then((result) => result.stdout.trim() === "active")
        .catch(() => false);
      checks.push([
        unit,
        active ? "PASS" : "WARN",
        active ? "active" : "not active as a systemd user service"
      ]);
    }
  }
  for (const root of config.allowedRoots) {
    await access(root, constants.R_OK)
      .then(() => checks.push([`Allowed root`, "PASS", root]))
      .catch(() => checks.push([`Allowed root`, "FAIL", root]));
  }
  if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) {
    checks.push([
      "Network exposure",
      "WARN",
      `${config.host}:${config.port} requires a trusted network or HTTPS proxy`
    ]);
  }
  for (const [name, state, detail] of checks) {
    process.stdout.write(`${state.padEnd(5)} ${name.padEnd(24)} ${detail}\n`);
  }
  if (checks.some(([, state]) => state === "FAIL")) process.exitCode = 1;
}

async function resetKey(): Promise<void> {
  const key = generateAccessKey();
  await persistAccessKey(key, "access_key.reset");
  const restartNote = await restartServerAfterKeyChange();
  process.stdout.write(
    `New Pi Web access key (shown once):\n${key}\n\n${restartNote}\n`
  );
}

async function setPassword(): Promise<void> {
  assertDatabaseManagedAccessKey();
  const options = process.argv.slice(3);
  const useStdin = options.length === 1 && options[0] === "--stdin";
  if (options.length > 0 && !useStdin) {
    throw new Error(
      "Usage: pi-web set-password [--stdin]. Password values are not accepted as command arguments."
    );
  }

  let key: string;
  if (useStdin) {
    key = await readAccessKeyFromStdin();
  } else {
    const first = validateAccessKeyInput(
      await readMaskedAccessKey("New Pi Web password: ")
    );
    const confirmation = await readMaskedAccessKey("Confirm password: ");
    key = confirmAccessKeyInput(first, confirmation);
  }

  await persistAccessKey(key, "access_key.set");
  const restartNote = await restartServerAfterKeyChange();
  process.stdout.write(`Pi Web password updated.\n${restartNote}\n`);
}

function assertDatabaseManagedAccessKey(): void {
  if (process.env.PI_WEB_ACCESS_KEY) {
    throw new Error(
      "PI_WEB_ACCESS_KEY manages the access key. Change that environment value and restart pi-web-server."
    );
  }
}

async function persistAccessKey(
  key: string,
  auditType: "access_key.reset" | "access_key.set"
): Promise<void> {
  assertDatabaseManagedAccessKey();
  const paths = resolvePaths();
  await ensureDirectories(paths);
  const hash = await hashAccessKey(key);
  const db = new SessionDatabase(paths.databaseFile);
  try {
    db.setSetting("access_key_hash", hash);
    db.deleteSetting("auth_sessions");
    db.audit(auditType, "success", "cli");
  } finally {
    db.close();
  }
}

async function restartServerAfterKeyChange(): Promise<string> {
  if (platform() === "linux") {
    const restarted = await execFileAsync("systemctl", [
      "--user",
      "restart",
      "pi-web-server.service"
    ])
      .then(() => true)
      .catch(() => false);
    if (restarted) {
      return "pi-web-server was restarted; existing browser sessions are invalid.";
    }
  }
  return "Restart pi-web-server to invalidate in-memory login sessions immediately.";
}

function renderUnit(service: "sessiond" | "server", node: string, cli: string): string {
  const dependency =
    service === "server"
      ? "Requires=pi-web-sessiond.service\nAfter=network.target pi-web-sessiond.service"
      : "After=network.target";
  return `[Unit]
Description=Pi Web ${service === "server" ? "web server" : "session daemon"}
${dependency}

[Service]
Type=simple
ExecStart=${systemdEscape(node)} ${systemdEscape(cli)} ${service}
Restart=on-failure
RestartSec=2
UMask=0077
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function systemdEscape(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error("Invalid executable path");
  return value.replaceAll("\\", "\\\\").replaceAll(" ", "\\x20");
}

async function writePrivate(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

function installSignalHandlers(close: () => Promise<void>): void {
  const shutdown = () => {
    void close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Session daemon did not become ready");
}

async function canConnect(path: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection(path);
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function canConnectTcp(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(700, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function displayHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function printHelp(): void {
  process.stdout.write(`Pi Web ${VERSION}

Usage: pi-web <command>

  start       Run sessiond and server in the foreground
  server      Run only the HTTP/WebSocket server
  sessiond    Run only the session daemon and scheduler
  install     Install and start systemd user services (Linux)
  uninstall   Remove services while preserving data
  status      Show service state and address
  doctor      Diagnose Node, Pi, SQLite, socket, roots, and exposure
  set-password
              Set a custom access password using a hidden prompt
  set-key     Alias for set-password
  reset-key   Generate a new access key
  version     Print the Pi Web version
`);
}

void main().catch((error) => {
  process.stderr.write(`Pi Web: ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
