import { safeErrorMessage } from "@pi-web/shared";

type CombinedService = "sessiond" | "server";

export interface CombinedChildProcess {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  once(event: "error", listener: (error: Error) => void): this;
  off(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
  off(event: "error", listener: (error: Error) => void): this;
}

export interface CombinedRuntimeDependencies {
  spawnService(service: CombinedService): CombinedChildProcess;
  waitForSessiond(signal: AbortSignal): Promise<void>;
  addSignalListener(
    signal: "SIGINT" | "SIGTERM",
    listener: () => void
  ): void;
  removeSignalListener(
    signal: "SIGINT" | "SIGTERM",
    listener: () => void
  ): void;
  terminationGraceMs?: number;
}

interface CombinedChildRecord {
  service: CombinedService;
  child: CombinedChildProcess;
  failedToSpawn: boolean;
}

interface CombinedChildOutcome {
  service: CombinedService;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export async function runCombined(
  dependencies: CombinedRuntimeDependencies
): Promise<void> {
  const children: CombinedChildRecord[] = [];
  const readiness = new AbortController();
  let stopRequested = false;
  let primaryError: unknown;
  const requestStop = () => {
    stopRequested = true;
    readiness.abort();
    for (const { child, failedToSpawn } of children) {
      if (failedToSpawn || childHasExited(child)) continue;
      try {
        child.kill("SIGTERM");
      } catch {
        // The bounded final cleanup reports a process that cannot be stopped.
      }
    }
  };
  dependencies.addSignalListener("SIGINT", requestStop);
  dependencies.addSignalListener("SIGTERM", requestStop);

  try {
    const sessiond = startCombinedChild("sessiond", dependencies, children);
    const sessiondOutcome = observeCombinedChild(sessiond);
    const startup = await Promise.race([
      dependencies.waitForSessiond(readiness.signal).then(
        () => ({ kind: "ready" as const }),
        (error: unknown) => ({ kind: "readiness-error" as const, error })
      ),
      sessiondOutcome.then((outcome) => ({
        kind: "child-exit" as const,
        outcome
      }))
    ]);

    if (!stopRequested && startup.kind === "readiness-error") {
      throw startup.error;
    }
    if (!stopRequested && startup.kind === "child-exit") {
      throw combinedChildFailure(startup.outcome, true);
    }
    if (!stopRequested && startup.kind === "ready") {
      const server = startCombinedChild("server", dependencies, children);
      const outcome = await Promise.race([
        sessiondOutcome,
        observeCombinedChild(server)
      ]);
      if (!stopRequested) {
        throw combinedChildFailure(outcome, false);
      }
    }
  } catch (error) {
    primaryError = error;
  } finally {
    readiness.abort();
    dependencies.removeSignalListener("SIGINT", requestStop);
    dependencies.removeSignalListener("SIGTERM", requestStop);
    const cleanup = await Promise.allSettled(
      children.map(async ({ child, failedToSpawn }) => {
        if (failedToSpawn) return;
        await terminateCombinedChild(
          child,
          dependencies.terminationGraceMs ?? 5_000
        );
      })
    );
    if (primaryError === undefined) {
      primaryError = cleanup.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      )?.reason;
    }
  }

  if (primaryError !== undefined) throw primaryError;
}

function startCombinedChild(
  service: CombinedService,
  dependencies: CombinedRuntimeDependencies,
  children: CombinedChildRecord[]
): CombinedChildRecord {
  const record: CombinedChildRecord = {
    service,
    child: dependencies.spawnService(service),
    failedToSpawn: false
  };
  children.push(record);
  return record;
}

function observeCombinedChild(
  record: CombinedChildRecord
): Promise<CombinedChildOutcome> {
  const { child, service } = record;
  if (childHasExited(child)) {
    return Promise.resolve({
      service,
      code: child.exitCode,
      signal: child.signalCode
    });
  }
  return new Promise((resolve) => {
    const cleanup = () => {
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null
    ) => {
      cleanup();
      resolve({ service, code, signal });
    };
    const onError = (error: Error) => {
      record.failedToSpawn = true;
      cleanup();
      resolve({ service, code: null, signal: null, error });
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function combinedChildFailure(
  outcome: CombinedChildOutcome,
  beforeReady: boolean
): Error {
  const phase = beforeReady ? " before becoming ready" : "";
  if (outcome.error) {
    return new Error(
      `${outcome.service} failed to start${phase}: ${safeErrorMessage(
        outcome.error
      )}`,
      { cause: outcome.error }
    );
  }
  if (outcome.signal) {
    return new Error(
      `${outcome.service} exited from signal ${outcome.signal}${phase}`
    );
  }
  return new Error(
    `${outcome.service} exited with code ${outcome.code ?? "unknown"}${phase}`
  );
}

async function terminateCombinedChild(
  child: CombinedChildProcess,
  graceMs: number
): Promise<void> {
  if (childHasExited(child)) return;
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onExit = () => settle();
    const onError = (error: Error) => fail(error);
    const force = () => {
      timer = null;
      if (childHasExited(child)) {
        settle();
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch (error) {
        fail(error);
        return;
      }
      if (childHasExited(child)) {
        settle();
        return;
      }
      timer = setTimeout(
        () => fail(new Error("Child service did not exit after SIGKILL")),
        Math.max(0, graceMs)
      );
    };
    child.once("exit", onExit);
    child.once("error", onError);
    try {
      child.kill("SIGTERM");
    } catch (error) {
      fail(error);
      return;
    }
    if (settled || childHasExited(child)) {
      settle();
      return;
    }
    timer = setTimeout(force, Math.max(0, graceMs));
  });
}

function childHasExited(child: CombinedChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function sessiondEnvironment(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const blocked = new Set([
    "PI_WEB_ACCESS_KEY",
    "PI_WEB_SCHEDULER_SOCKET",
    "PI_WEB_SCHEDULER_TOKEN",
    "PI_WEB_SESSION_ID"
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !blocked.has(key.toUpperCase()))
  );
}
