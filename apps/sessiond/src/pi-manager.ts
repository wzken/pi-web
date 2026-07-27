import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { PiWebConfig } from "@pi-web/config";
import { PiRpcWorker } from "@pi-web/pi-rpc";
import { PiWebError, safeErrorMessage } from "@pi-web/shared";
import { SessionDatabase } from "./database.js";

const execFileAsync = promisify(execFile);

export interface PiManagerStatus {
  available: boolean;
  executable: string;
  version: string | null;
  models: Array<{ provider: string; id: string; label: string }>;
  providers: Array<{ id: string; configured: boolean; modelCount: number }>;
  packages: string[];
  skills: ResourceItem[];
  extensions: ResourceItem[];
  templates: ResourceItem[];
  errors: string[];
}

interface ResourceItem {
  name: string;
  path: string;
  location: "user";
}

export class PiManager {
  #config: PiWebConfig;
  readonly #db: SessionDatabase;

  constructor(config: PiWebConfig, db: SessionDatabase) {
    this.#config = config;
    this.#db = db;
  }

  updateConfig(config: PiWebConfig): void {
    this.#config = config;
  }

  async status(): Promise<PiManagerStatus> {
    const errors: string[] = [];
    const [versionResult, listResult, modelResult, resources] = await Promise.all([
      this.#run(["--version"]).catch((error) => {
        errors.push(`version: ${safeErrorMessage(error)}`);
        return null;
      }),
      this.#run(["list"]).catch((error) => {
        errors.push(`packages: ${safeErrorMessage(error)}`);
        return null;
      }),
      this.#run(["--list-models"]).catch((error) => {
        errors.push(`models: ${safeErrorMessage(error)}`);
        return null;
      }),
      this.#discoverResources().catch((error) => {
        errors.push(`resources: ${safeErrorMessage(error)}`);
        return { skills: [], extensions: [], templates: [] };
      })
    ]);
    const models = parseModels(modelResult?.stdout ?? "");
    const providerMap = new Map<string, number>();
    for (const model of models) {
      providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
    }
    return {
      available: versionResult !== null,
      executable: this.#config.piExecutable,
      version: versionResult?.stdout.trim() || null,
      models,
      providers: [...providerMap.entries()].map(([id, modelCount]) => ({
        id,
        configured: true,
        modelCount
      })),
      packages: parsePackageList(listResult?.stdout ?? ""),
      ...resources,
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
      const result = await this.#run(args, 5 * 60_000);
      this.#db.audit(`package.${input.action}`, "success", actor, null, {
        source: input.source ? redactSource(input.source) : null
      });
      return result;
    } catch (error) {
      this.#db.audit(`package.${input.action}`, "failure", actor);
      throw error;
    }
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
    const packages = await this.#run(["list"]).catch((error) => {
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

  async modelExists(model: string): Promise<boolean> {
    const models = parseModels((await this.#run(["--list-models"])).stdout);
    return models.some((candidate) => `${candidate.provider}/${candidate.id}` === model);
  }

  async #probeRpc(): Promise<boolean> {
    const worker = new PiRpcWorker({
      executable: this.#config.piExecutable,
      cwd: homedir(),
      name: "Pi Web Doctor",
      noSession: true,
      requestTimeoutMs: 10_000
    });
    try {
      await worker.start();
      return true;
    } finally {
      await worker.close(1000).catch(() => undefined);
    }
  }

  async #run(
    args: string[],
    timeout = 20_000
  ): Promise<{ stdout: string; stderr: string }> {
    const result = await execFileAsync(this.#config.piExecutable, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: process.env
    });
    return { stdout: result.stdout, stderr: result.stderr };
  }

  async #discoverResources(): Promise<{
    skills: ResourceItem[];
    extensions: ResourceItem[];
    templates: ResourceItem[];
  }> {
    const base =
      process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
    const [skills, extensions, templates] = await Promise.all([
      listResources(join(base, "skills"), "skill"),
      listResources(join(base, "extensions"), "extension"),
      listResources(join(base, "prompts"), "prompt")
    ]);
    return { skills, extensions, templates };
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
    isAbsolute(source)
  ) {
    return source;
  }
  throw new PiWebError(
    "INVALID_PACKAGE_SOURCE",
    "Use an npm:, git:, URL, or absolute local package source",
    400
  );
}

export function parseModels(output: string): PiManagerStatus["models"] {
  const results: PiManagerStatus["models"] = [];
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
  let inPackageSection = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = stripAnsi(rawLine);
    if (/^(?:User|Project) packages:\s*$/i.test(line.trim())) {
      inPackageSection = true;
      continue;
    }
    if (/^No packages installed\.\s*$/i.test(line.trim())) return [];
    if (
      inPackageSection &&
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

async function listResources(
  directory: string,
  kind: "skill" | "extension" | "prompt"
): Promise<ResourceItem[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  );
  const results: ResourceItem[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (kind === "skill" && entry.isDirectory()) {
      const skillFile = join(path, "SKILL.md");
      if (await exists(skillFile)) {
        const title = await firstHeading(skillFile);
        results.push({ name: title || entry.name, path: skillFile, location: "user" });
      }
    } else if (kind !== "skill" && (entry.isDirectory() || entry.isFile())) {
      results.push({ name: entry.name, path, location: "user" });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function exists(path: string): Promise<boolean> {
  return await stat(path).then(() => true).catch(() => false);
}

async function firstHeading(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
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
