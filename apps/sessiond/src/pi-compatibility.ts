import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PiRpcWorker, workerEnvironment } from "@pi-web/pi-rpc";
import { PiWebError, safeErrorMessage } from "@pi-web/shared";

const execFileAsync = promisify(execFile);

export const minimumPiVersion = "0.84.1";
export const requiredPiRpcCommands = [
  "get_state",
  "get_available_models",
  "get_available_thinking_levels",
  "get_commands",
  "get_entries",
  "get_tree"
] as const;

export interface PiCompatibilityReport {
  version: string | null;
  minimumVersion: string;
  compatible: boolean;
  rpcCommands: string[];
  errors: string[];
}

const reports = new Map<string, Promise<PiCompatibilityReport>>();

export function inspectPiCompatibility(
  executable: string,
  cwd: string
): Promise<PiCompatibilityReport> {
  const key = executable;
  const existing = reports.get(key);
  if (existing) return existing;
  const report = inspect(executable, cwd).catch((error) => ({
    version: null,
    minimumVersion: minimumPiVersion,
    compatible: false,
    rpcCommands: [],
    errors: [safeErrorMessage(error)]
  }));
  reports.set(key, report);
  return report;
}

export async function assertPiCompatible(
  executable: string,
  cwd: string
): Promise<PiCompatibilityReport> {
  const report = await inspectPiCompatibility(executable, cwd);
  if (!report.compatible) {
    throw new PiWebError(
      "PI_VERSION_UNSUPPORTED",
      report.errors[0] ??
        `Pi ${minimumPiVersion} or newer with the required RPC commands is required`,
      409,
      report
    );
  }
  return report;
}

async function inspect(
  executable: string,
  cwd: string
): Promise<PiCompatibilityReport> {
  const errors: string[] = [];
  let version: string | null = null;
  try {
    const result = await execFileAsync(executable, ["--version"], {
      cwd,
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: workerEnvironment(process.env)
    });
    version = extractPiVersion(result.stdout);
    if (!version) errors.push("Unable to parse the installed Pi version");
    else if (compareSemver(version, minimumPiVersion) < 0) {
      errors.push(
        `Pi ${version} is unsupported; Pi ${minimumPiVersion} or newer is required`
      );
    }
  } catch (error) {
    errors.push(`Unable to execute Pi: ${safeErrorMessage(error)}`);
  }

  const rpcCommands: string[] = [];
  if (errors.length === 0) {
    const worker = new PiRpcWorker({
      executable,
      cwd,
      name: "Pi Web compatibility probe",
      noSession: true,
      requestTimeoutMs: 10_000
    });
    try {
      await worker.start();
      for (const command of requiredPiRpcCommands) {
        try {
          await worker.send({ type: command });
          rpcCommands.push(command);
        } catch (error) {
          errors.push(
            `Required Pi RPC command ${command} is unavailable: ${safeErrorMessage(error)}`
          );
        }
      }
    } catch (error) {
      errors.push(`Unable to start Pi RPC mode: ${safeErrorMessage(error)}`);
    } finally {
      await worker.close(1000).catch(() => undefined);
    }
  }

  return {
    version,
    minimumVersion: minimumPiVersion,
    compatible: errors.length === 0,
    rpcCommands,
    errors
  };
}

export function extractPiVersion(value: string): string | null {
  return value.match(/\b(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/)?.[1] ?? null;
}

export function compareSemver(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
