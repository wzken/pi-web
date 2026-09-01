import { describe, expect, it } from "vitest";
import {
  ipcContract,
  isIpcMethod,
  type IpcMethodParams,
  type IpcMethodResult
} from "./index.js";

describe("IPC method contract", () => {
  it("recognizes only declared methods", () => {
    expect(isIpcMethod("sessions.get")).toBe(true);
    expect(isIpcMethod("sessions.promt")).toBe(false);
  });

  it("declares authorization roles in the same registry", () => {
    expect(ipcContract["protocol.handshake"].role).toBe("handshake");
    expect(ipcContract["scheduler.tool"].role).toBe("extension");
    expect(ipcContract["sessions.get"].role).toBe("server");
  });

  it("keeps request and result types tied to the method", () => {
    const params: IpcMethodParams<"sessions.get"> = { id: "session-id" };
    const result: IpcMethodResult<"sessions.get"> = {
      id: params.id,
      piSessionReference: null,
      cwd: "/tmp",
      displayName: "Session",
      status: "waiting",
      workerPid: null,
      model: null,
      thinkingLevel: null,
      systemPrompt: null,
      startedAt: "2026-08-30T00:00:00.000Z",
      settledAt: null,
      endedAt: null,
      exitCode: null,
      interruptionReason: null,
      lastEventSequence: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      reportedCost: null,
      estimatedCost: null,
      costStatus: "unknown",
      toolCalls: 0,
      createdBy: "web",
      scheduleRunId: null,
      updatedAt: "2026-08-30T00:00:00.000Z"
    };

    expect(result.id).toBe(params.id);
  });
});
