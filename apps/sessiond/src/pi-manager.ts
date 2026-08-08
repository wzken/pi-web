import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { PiWebConfig } from "@pi-web/config";
import { PiRpcWorker, workerEnvironment } from "@pi-web/pi-rpc";
import type { PiStatus } from "@pi-web/protocol";
import { PiWebError, safeErrorMessage } from "@pi-web/shared";
import { SessionDatabase } from "./database.js";

const execFileAsync = promisify(execFile);

interface PiCommandOptions {
  timeout: number;
  cwd?: string;
  windowsHide: boolean;
  maxBuffer: number;
  encoding: "utf8";
  env: NodeJS.ProcessEnv;
}

type PiCommandExecutor = (
  executable: string,
  args: string[],
  options: PiCommandOptions
) => Promise<{ stdout: string; stderr: string }>;

const defaultPiCommandExecutor: PiCommandExecutor = async (
  executable,
  args,
  options
) => {
  const result = await execFileAsync(executable, args, options);
  return { stdout: result.stdout, stderr: result.stderr };
};

export class PiManager {
  #config: PiWebConfig;
  readonly #db: SessionDatabase;
  readonly #execute: PiCommandExecutor;

  constructor(
    config: PiWebConfig,
    db: SessionDatabase,
    execute: PiCommandExecutor = defaultPiCommandExecutor
  ) {
    this.#config = config;
    this.#db = db;
    this.#execute = execute;
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  async status(): Promise<PiStatus> {
    const errors: string[] = [];
    const [versionResult, listResult, modelResult] = await Promise.all([
      this.#run(["--version"]).catch((error) => {
        errors.push(`version: ${safeErrorMessage(error)}`);
        return null;
      }),
      this.#runGlobalCommand(["list"]).catch((error) => {
        errors.push(`packages: ${safeErrorMessage(error)}`);
        return null;
      }),
      this.#runGlobalCommand(["--list-models"]).catch((error) => {
        errors.push(`models: ${safeErrorMessage(error)}`);
        return null;
      })
    ]);
    const models = parseModels(modelResult?.stdout ?? "");
    return {
      available: versionResult !== null,
      executable: this.#config.piExecutable,
      version: versionResult?.stdout.trim() || null,
      models,
      packages: parsePackageList(listResult?.stdout ?? ""),
      errors
    };
  }

  async packageOperation(input: {
    action: "install" | "remove" | "update_all";
    source?: string;
    actor?: string;
  }): Promise<{ stdout: string; stderr: string }> {
    const actor = input.actor ?? "web";
    try {
      let args: string[];
      if (input.action === "update_all") {
        args = ["update", "--extensions"];
      } else {
        const source = validatePackageSource(input.source);
        args = [input.action, source];
      }
      const result = await this.#runGlobalCommand(args, 5 * 60_000);
      this.#db.audit(`package.${input.action}`, "success", actor, null, {
        source: input.source ? redactSource(input.source) : null
      });
      return result;
    } catch (error) {
      this.#db.audit(`package.${input.action}`, "failure", actor);
      throw error;
    }
  }

  async modelExists(model: string): Promise<boolean> {
    const models = parseModels(
      (await this.#runGlobalCommand(["--list-models"])).stdout
    );
    return models.some(
      (candidate) => `${candidate.provider}/${candidate.id}` === model
    );
  }

  async doctorProbe(): Promise<{
    available: boolean;
    version: string | null;
    rpcStartable: boolean;
    packageCommands: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    const version = await this.#run(["--version"]).catch((error) => {
      errors.push(safeErrorMessage(error));
      return null;
    });
    const packages = await this.#runGlobalCommand(["list"]).catch((error) => {
      errors.push(safeErrorMessage(error));
      return null;
    });
    const rpcStartable = await this.#probeRpc().catch((error) => {
      errors.push(`RPC: ${safeErrorMessage(error)}`);
      return false;
    });
    return {
      available: version !== null,
      version: version?.stdout.trim() || null,
      rpcStartable,
      packageCommands: packages !== null,
      errors
    };
  }

  async #probeRpc(): Promise<boolean> {
    return await this.#withNeutralCwd(async (cwd) => {
      const worker = new PiRpcWorker({
        executable: this.#config.piExecutable,
        cwd,
        name: "Pi Web Doctor",
        noSession: true,
        requestTimeoutMs: 10_000
      });
      try {
        await worker.start();
        return true;
      } finally {
        await worker.close(1000);
      }
    });
  }

  async #run(
    args: string[],
    timeout = 20_000,
    cwd?: string
  ): Promise<{ stdout: string; stderr: string }> {
    return await this.#execute(this.#config.piExecutable, args, {
      timeout,
      ...(cwd ? { cwd } : {}),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: workerEnvironment(process.env)
    });
  }

  async #runGlobalCommand(
    args: string[],
    timeout = 20_000
  ): Promise<{ stdout: string; stderr: string }> {
    return await this.#withNeutralCwd(
      async (cwd) => await this.#run(args, timeout, cwd)
    );
  }

  async #withNeutralCwd<T>(
    operation: (cwd: string) => Promise<T>
  ): Promise<T> {
    const temporaryRoot = resolve(tmpdir());
    const prefix = "pi-web-global-scope-";
    const cwd = await mkdtemp(join(temporaryRoot, prefix));
    try {
      // Pi infers project resources from cwd. Global discovery and diagnostics
      // run from a neutral directory so project settings and extensions remain
      // owned by their individual workers.
      return await operation(cwd);
    } finally {
      const resolved = resolve(cwd);
      if (
        dirname(resolved) === temporaryRoot &&
        basename(resolved).startsWith(prefix)
      ) {
        await rm(resolved, { recursive: true, force: true }).catch(
          () => undefined
        );
      }
    }
  }
}

export function validatePackageSource(source: string | undefined): string {
  if (!source || source.length > 512 || /[\0\r\n]/.test(source)) {
    throw new PiWebError("INVALID_PACKAGE_SOURCE", "Invalid package source", 400);
  }
  if (
    source.startsWith("npm:") ||
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://") ||
    isAbsolute(source)
  ) {
    return source;
  }
  throw new PiWebError(
    "INVALID_PACKAGE_SOURCE",
    "Use an npm:, git:, HTTP(S), SSH, or absolute local package source",
    400
  );
}

export function parseModels(output: string): PiStatus["models"] {
  const results: PiStatus["models"] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = stripAnsi(line).trim();
    if (!trimmed || /^provider\s{2,}model\b/i.test(trimmed)) continue;
    const columns = trimmed.split(/\s{2,}/);
    let provider = columns[0] ?? "";
    let id = columns[1] ?? "";
    if (!provider || !id) {
      const slash = trimmed.match(
        /(?:^|\s)([\w.-]+)\/([\w./:@+-]+)(?:\s|$)/
      );
      provider = slash?.[1] ?? "";
      id = slash?.[2] ?? "";
    }
    if (!provider || !id) continue;
    results.push({
      provider,
      id,
      label: trimmed
    });
  }
  return results;
}

export function parsePackageList(output: string): string[] {
  const results: string[] = [];
  let inUserPackageSection = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = stripAnsi(rawLine);
    if (/^User packages:\s*$/i.test(line.trim())) {
      inUserPackageSection = true;
      continue;
    }
    if (/^Project packages:\s*$/i.test(line.trim())) {
      inUserPackageSection = false;
      continue;
    }
    if (/^No packages installed\.\s*$/i.test(line.trim())) return [];
    if (
      inUserPackageSection &&
      /^ {2}\S/.test(line) &&
      !/^ {4}/.test(line)
    ) {
      results.push(line.trim().replace(/\s+\(filtered\)$/, ""));
    }
  }
  return results;
}

function stripAnsi(value: string): string {
  return value.replace(
    // ANSI CSI sequences emitted by chalk when color is forced.
    /\u001b\[[0-?]*[ -/]*[@-~]/g,
    ""
  );
}

function redactSource(source: string): string {
  try {
    const url = new URL(source);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return source;
  }
}
