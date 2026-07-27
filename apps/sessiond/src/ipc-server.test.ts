import { describe, expect, it } from "vitest";
import type { InternalRequest } from "@pi-web/protocol";
import { authorizeIpcRequest } from "./ipc-server.js";

function request(
  method: string,
  token?: string
): InternalRequest {
  return {
    kind: "request",
    id: "request-1",
    method,
    ...(token
      ? { auth: { role: "server" as const, token } }
      : {})
  };
}

describe("IPC connection authorization", () => {
  const serverToken = "server-only-token";

  it("rejects server methods until the connection presents the server token", () => {
    expect(() =>
      authorizeIpcRequest("unknown", request("sessions.list"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_AUTH_REQUIRED" }));
    expect(() =>
      authorizeIpcRequest(
        "unknown",
        request("sessions.list", "wrong-token"),
        serverToken
      )
    ).toThrowError(expect.objectContaining({ code: "IPC_AUTH_REQUIRED" }));
    expect(
      authorizeIpcRequest(
        "unknown",
        request("sessions.list", serverToken),
        serverToken
      )
    ).toBe("server");
  });

  it("keeps authenticated extension connections limited to scheduler tools", () => {
    expect(
      authorizeIpcRequest("unknown", request("scheduler.tool"), serverToken)
    ).toBe("extension");
    expect(() =>
      authorizeIpcRequest("extension", request("sessions.list"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_ROLE_FORBIDDEN" }));
    expect(
      authorizeIpcRequest("extension", request("scheduler.tool"), serverToken)
    ).toBe("extension");
  });

  it("prevents server connections from switching into the extension role", () => {
    expect(() =>
      authorizeIpcRequest("server", request("scheduler.tool"), serverToken)
    ).toThrowError(expect.objectContaining({ code: "IPC_ROLE_FORBIDDEN" }));
  });
});
