import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { thinkingLevels } from "@pi-web/protocol";

const configSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().int().min(1).max(65_535).default(8787),
  allowedRoots: z.array(z.string()).min(1).default([homedir()]),
  allowAnyDirectory: z.boolean().default(false),
  defaultTimezone: z.string().default("UTC"),
  defaultCronTimeoutSeconds: z.number().int().min(1).max(86_400).default(3600),
  minimumCronIntervalMinutes: z.number().int().min(1).default(5),
  modelSchedulePolicy: z
    .enum(["allow", "create_disabled", "deny"])
    .default("allow"),
  piExecutable: z.string().default("pi"),
  trustedProxy: z.boolean().default(false),
  cookieSecure: z.enum(["auto", "always", "never"]).default("auto"),
  defaultModel: z.string().nullable().default(null),
  defaultThinkingLevel: z.enum(thinkingLevels).nullable().default(null),
  defaultSystemPrompt: z.string().nullable().default(null),
  maxScheduledJobs: z.number().int().min(1).max(10_000).default(200),
  maxConcurrentWorkers: z.number().int().min(1).max(128).default(8),
  eventBufferSize: z.number().int().min(100).max(100_000).default(2000)
});

export type PiWebConfig = z.infer<typeof configSchema>;

export interface PiWebPaths {
  configDir: string;
  configFile: string;
  dataDir: string;
  cacheDir: string;
  databaseFile: string;
  socketPath: string;
  ipcTokenFile: string;
  runtimeDir: string;
}

function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): PiWebPaths {
  const home = env.HOME || env.USERPROFILE || homedir();
  const configDir = env.PI_WEB_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, ".config"), "pi-web");
  const dataDir = env.PI_WEB_DATA_DIR || join(env.XDG_DATA_HOME || join(home, ".local", "share"), "pi-web");
  const cacheDir = env.PI_WEB_CACHE_DIR || join(env.XDG_CACHE_HOME || join(home, ".cache"), "pi-web");
  const socketPath =
    env.PI_WEB_SESSIOND_SOCKET ||
    (platform() === "win32"
      ? `\\\\.\\pipe\\pi-web-sessiond-${createHash("sha256").update(dataDir).digest("hex").slice(0, 12)}`
      : join(dataDir, "sessiond.sock"));
  return {
    configDir,
    configFile: env.PI_WEB_CONFIG || join(configDir, "config.json"),
    dataDir,
    cacheDir,
    databaseFile: env.PI_WEB_DATABASE || join(dataDir, "pi-web.sqlite"),
    socketPath,
    ipcTokenFile: join(dataDir, "runtime", "ipc-server-token"),
    runtimeDir: join(dataDir, "runtime")
  };
}

export async function ensureDirectories(paths = resolvePaths()): Promise<void> {
  for (const path of [paths.configDir, paths.dataDir, paths.cacheDir, paths.runtimeDir]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (platform() !== "win32") await chmod(path, 0o700);
  }
}

export async function loadConfig(
  overrides: Partial<PiWebConfig> = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<PiWebConfig> {
  const paths = resolvePaths(env);
  let fromFile: unknown = {};
  try {
    fromFile = JSON.parse(await readFile(paths.configFile, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const roots = env.PI_WEB_ALLOWED_ROOTS
    ?.split(platform() === "win32" ? ";" : ":")
    .map((item) => item.trim())
    .filter(Boolean);

  const fromEnv = {
    host: env.PI_WEB_HOST,
    port: envNumber(env.PI_WEB_PORT),
    allowedRoots: roots?.length ? roots : undefined,
    allowAnyDirectory: envBoolean(env.PI_WEB_ALLOW_ANY_DIRECTORY),
    defaultTimezone: env.PI_WEB_DEFAULT_TIMEZONE,
    defaultCronTimeoutSeconds: envNumber(env.PI_WEB_DEFAULT_CRON_TIMEOUT_SECONDS),
    minimumCronIntervalMinutes: envNumber(env.PI_WEB_MINIMUM_CRON_INTERVAL_MINUTES),
    modelSchedulePolicy: env.PI_WEB_MODEL_SCHEDULE_POLICY,
    piExecutable: env.PI_WEB_PI_EXECUTABLE,
    trustedProxy: envBoolean(env.PI_WEB_TRUSTED_PROXY),
    cookieSecure: env.PI_WEB_COOKIE_SECURE,
    defaultModel: env.PI_WEB_DEFAULT_MODEL,
    defaultThinkingLevel: env.PI_WEB_DEFAULT_THINKING_LEVEL,
    defaultSystemPrompt: env.PI_WEB_DEFAULT_SYSTEM_PROMPT,
    maxScheduledJobs: envNumber(env.PI_WEB_MAX_SCHEDULED_JOBS),
    maxConcurrentWorkers: envNumber(env.PI_WEB_MAX_CONCURRENT_WORKERS),
    eventBufferSize: envNumber(env.PI_WEB_EVENT_BUFFER_SIZE)
  };

  const compact = Object.fromEntries(
    Object.entries(fromEnv).filter(([, value]) => value !== undefined)
  );
  return configSchema.parse({ ...(fromFile as object), ...compact, ...overrides });
}

export async function saveConfig(
  config: PiWebConfig,
  paths = resolvePaths()
): Promise<void> {
  await ensureDirectories(paths);
  const normalized = configSchema.parse(config);
  const temp = `${paths.configFile}.${process.pid}.tmp`;
  await mkdir(dirname(paths.configFile), { recursive: true, mode: 0o700 });
  await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  if (platform() !== "win32") await chmod(temp, 0o600);
  await rename(temp, paths.configFile);
}

export function parseConfig(value: unknown): PiWebConfig {
  return configSchema.parse(value);
}

export function publicConfig(config: PiWebConfig): PiWebConfig {
  return { ...config };
}
