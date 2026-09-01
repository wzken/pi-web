import type { PiRpcWorker } from "@pi-web/pi-rpc";
import type {
  PendingExtensionInteraction,
  SessionRecord
} from "@pi-web/protocol";
import type { RunningSessionProjection } from "./running-session-projection.js";
import { PiWebError } from "@pi-web/shared";

export interface WorkerRuntime {
  worker: PiRpcWorker;
  closeRequested: boolean;
  token: string;
  projection: RunningSessionProjection;
  activityGeneration: number;
  pendingInteractions: Map<string, PendingExtensionInteraction>;
  interactionTimers: Map<string, NodeJS.Timeout>;
  respondingInteractions: Set<string>;
}

export class RuntimeRegistry {
  readonly workers = new Map<string, WorkerRuntime>();
  readonly workerTokens = new Map<string, string>();
  readonly sessionStarts = new Map<string, Promise<SessionRecord>>();
  readonly resumeInputQueues = new Map<string, Promise<void>>();
  readonly backgroundTasks = new Set<Promise<void>>();
  #workerSlotReservations = 0;

  get activeCount(): number {
    return this.workers.size;
  }

  get reservedWorkerSlots(): number {
    return this.#workerSlotReservations;
  }

  register(id: string, runtime: WorkerRuntime): void {
    this.workers.set(id, runtime);
    this.workerTokens.set(runtime.token, id);
  }

  unregister(id: string, runtime: WorkerRuntime): boolean {
    this.workerTokens.delete(runtime.token);
    if (this.workers.get(id) !== runtime) return false;
    this.workers.delete(id);
    return true;
  }

  beginSessionStart(
    id: string,
    start: () => Promise<SessionRecord>
  ): { started: boolean; promise: Promise<SessionRecord> } {
    const existing = this.sessionStarts.get(id);
    if (existing) return { started: false, promise: existing };
    const tracked = Promise.resolve()
      .then(start)
      .finally(() => {
        if (this.sessionStarts.get(id) === tracked) {
          this.sessionStarts.delete(id);
        }
      });
    this.sessionStarts.set(id, tracked);
    return { started: true, promise: tracked };
  }

  reserveWorkerSlot(maxConcurrentWorkers: number): () => void {
    if (this.workers.size + this.#workerSlotReservations >= maxConcurrentWorkers) {
      throw new PiWebError(
        "WORKER_LIMIT",
        `At most ${maxConcurrentWorkers} workers may run concurrently`,
        429
      );
    }
    this.#workerSlotReservations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#workerSlotReservations -= 1;
    };
  }

  track(task: Promise<void>): void {
    this.backgroundTasks.add(task);
    void task
      .finally(() => this.backgroundTasks.delete(task))
      .catch(() => undefined);
  }

  async drain(): Promise<void> {
    while (
      this.sessionStarts.size > 0 ||
      this.resumeInputQueues.size > 0 ||
      this.backgroundTasks.size > 0
    ) {
      await Promise.allSettled([
        ...this.sessionStarts.values(),
        ...this.resumeInputQueues.values(),
        ...this.backgroundTasks
      ]);
    }
  }
}
