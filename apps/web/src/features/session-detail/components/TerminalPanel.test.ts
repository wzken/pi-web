import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sessionHeartbeatIntervalMs,
  sessionHeartbeatTimeoutMs
} from "../../../session-realtime";
import { createTerminalSocketHeartbeat } from "./TerminalPanel";

afterEach(() => vi.useRealTimers());

describe("createTerminalSocketHeartbeat", () => {
  it("pings an open terminal socket and closes it after a missed pong", () => {
    vi.useFakeTimers();
    const socket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn()
    };
    const heartbeat = createTerminalSocketHeartbeat(socket, 1);

    heartbeat.start();
    vi.advanceTimersByTime(sessionHeartbeatIntervalMs);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    expect(socket.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(sessionHeartbeatTimeoutMs);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("rearms the terminal heartbeat after a pong", () => {
    vi.useFakeTimers();
    const socket = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn()
    };
    const heartbeat = createTerminalSocketHeartbeat(socket, 1);

    heartbeat.start();
    vi.advanceTimersByTime(sessionHeartbeatIntervalMs);
    heartbeat.acknowledge();
    vi.advanceTimersByTime(sessionHeartbeatTimeoutMs);

    expect(socket.close).not.toHaveBeenCalled();
    heartbeat.stop();
  });
});
