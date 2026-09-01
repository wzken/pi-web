import { PiWebError } from "@pi-web/shared";
import type { IpcHandlerMap } from "./ipc-handler.js";
import { asRecord, optionalString, stringParam } from "./ipc-params.js";
import { Scheduler } from "./scheduler.js";
import { SessionSupervisor } from "./supervisor.js";

type ScheduleMethod =
  | "schedules.list"
  | "schedules.get"
  | "schedules.runs"
  | "schedules.create"
  | "schedules.update"
  | "schedules.enable"
  | "schedules.delete"
  | "schedules.run_now"
  | "scheduler.tool";

export function createScheduleHandlers(
  scheduler: Scheduler,
  supervisor: SessionSupervisor
): IpcHandlerMap<ScheduleMethod> {
  return {
    "schedules.list": () => scheduler.list(),
    "schedules.get": (raw) => scheduler.get(stringParam(asRecord(raw), "id")),
    "schedules.runs": (raw) => {
      const params = asRecord(raw);
      return scheduler.runs(optionalString(params.jobId) ?? undefined);
    },
    "schedules.create": async (raw) =>
      await scheduler.create(asRecord(raw), { actor: "web" }),
    "schedules.update": async (raw) => {
      const params = asRecord(raw);
      return await scheduler.update(
        stringParam(params, "id"),
        params,
        "web"
      );
    },
    "schedules.enable": (raw) => {
      const params = asRecord(raw);
      return scheduler.setEnabled(
        stringParam(params, "id"),
        params.enabled === true,
        "web"
      );
    },
    "schedules.delete": (raw) =>
      scheduler.delete(stringParam(asRecord(raw), "id"), "web"),
    "schedules.run_now": async (raw) =>
      await scheduler.runNow(stringParam(asRecord(raw), "id"), "web"),
    "scheduler.tool": async (raw) => {
      const params = asRecord(raw);
      const token = stringParam(params, "token");
      const sessionId = stringParam(params, "sessionId");
      if (supervisor.getWorkerSessionForToken(token) !== sessionId) {
        throw new PiWebError(
          "INVALID_WORKER_TOKEN",
          "Scheduler worker token is invalid or expired",
          403
        );
      }
      return await scheduler.tool(asRecord(params.input), sessionId);
    }
  };
}
