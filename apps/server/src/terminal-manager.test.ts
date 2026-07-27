import { describe, expect, it, vi } from "vitest";
import {
  TerminalManager,
  terminalEnvironment,
  type SpawnTerminal,
  type TerminalPeer,
  type TerminalProcess,
  type TerminalServerMessage
} from "./terminal-manager.js";

class FakeTerminalProcess implements TerminalProcess {
  readonly pid = 4321;
  readonly process = "fake-shell";
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  kills = 0;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener:
    | ((event: { exitCode: number; signal?: number }) => void)
    | null = null;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(columns: number, rows: number): void {
    this.resizes.push([columns, rows]);
  }

  kill(): void {
    this.kills += 1;
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListener = listener;
    return {
      dispose: () => {
        this.dataListener = null;
      }
    };
  }

  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void
  ): { dispose(): void } {
    this.exitListener = listener;
    return {
      dispose: () => {
        this.exitListener = null;
      }
    };
  }

  emitData(data: string): void {
    this.dataListener?.(data);
  }

  emitExit(exitCode: number, signal?: number): void {
    this.exitListener?.({
      exitCode,
      ...(signal === undefined ? {} : { signal })
    });
  }
}

function recordingPeer(): {
  peer: TerminalPeer;
  messages: TerminalServerMessage[];
} {
  const messages: TerminalServerMessage[] = [];
  return {
    peer: {
      send(message) {
        messages.push(message);
      }
    },
    messages
  };
}

describe("TerminalManager", () => {
  it("starts, writes, resizes and releases a terminal on exit", () => {
    const process = new FakeTerminalProcess();
    const spawn = vi.fn<SpawnTerminal>(() => process);
    const receiver = recordingPeer();
    const manager = new TerminalManager(spawn);

    const terminalId = manager.create({
      sessionId: "7d8fc8c7-2e9e-4f86-9d23-24fa7e680a20",
      cwd: "C:\\workspace",
      columns: 96,
      rows: 28,
      peer: receiver.peer
    });
    manager.write(terminalId, "echo ready\r");
    manager.resize(terminalId, 120, 36);
    process.emitData("ready\r\n");
    process.emitExit(0);

    expect(spawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        cwd: "C:\\workspace",
        cols: 96,
        rows: 28,
        name: "xterm-256color"
      })
    );
    expect(process.writes).toEqual(["echo ready\r"]);
    expect(process.resizes).toEqual([[120, 36]]);
    expect(receiver.messages).toEqual([
      expect.objectContaining({
        type: "ready",
        terminalId,
        reconnected: false,
        pid: 4321
      }),
      { type: "data", data: "ready\r\n" },
      { type: "exit", exitCode: 0 }
    ]);
    expect(manager.activeCount()).toBe(0);
  });

  it("reconnects only to the owning Pi session and replays buffered output", () => {
    const process = new FakeTerminalProcess();
    const first = recordingPeer();
    const second = recordingPeer();
    const manager = new TerminalManager(() => process, {
      orphanTtlMs: 10_000
    });
    const sessionId = "7d8fc8c7-2e9e-4f86-9d23-24fa7e680a20";
    const terminalId = manager.create({
      sessionId,
      cwd: "C:\\workspace",
      columns: 80,
      rows: 24,
      peer: first.peer
    });
    process.emitData("before reconnect\r\n");
    manager.detach(first.peer);

    expect(() =>
      manager.attach({
        terminalId,
        sessionId: "2d4791e2-3343-45dd-88af-6a475ef76a60",
        peer: second.peer
      })
    ).toThrowError(
      expect.objectContaining({ code: "TERMINAL_SESSION_MISMATCH" })
    );

    manager.attach({ terminalId, sessionId, peer: second.peer });
    expect(second.messages).toEqual([
      expect.objectContaining({ type: "ready", reconnected: true }),
      {
        type: "data",
        data: "before reconnect\r\n",
        replay: true
      }
    ]);
    manager.closeAll();
  });

  it("enforces the process limit and expires detached terminals", () => {
    vi.useFakeTimers();
    try {
      const process = new FakeTerminalProcess();
      const first = recordingPeer();
      const manager = new TerminalManager(() => process, {
        maxTerminals: 1,
        orphanTtlMs: 750
      });
      manager.create({
        sessionId: "7d8fc8c7-2e9e-4f86-9d23-24fa7e680a20",
        cwd: "C:\\workspace",
        columns: 80,
        rows: 24,
        peer: first.peer
      });

      expect(() =>
        manager.create({
          sessionId: "2d4791e2-3343-45dd-88af-6a475ef76a60",
          cwd: "C:\\workspace",
          columns: 80,
          rows: 24,
          peer: recordingPeer().peer
        })
      ).toThrowError(expect.objectContaining({ code: "TERMINAL_LIMIT" }));

      manager.detach(first.peer);
      vi.advanceTimersByTime(750);
      expect(process.kills).toBe(1);
      expect(manager.activeCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes server secrets and Node injection variables from the shell", () => {
    const env = terminalEnvironment({
      PATH: "C:\\Windows",
      NODE_OPTIONS: "--require attack.js",
      node_path: "C:\\untrusted",
      PI_WEB_ACCESS_KEY: "secret",
      PI_WEB_FAKE_PI: "1",
      SAFE_VALUE: "kept"
    });

    expect(env).toEqual({
      PATH: "C:\\Windows",
      SAFE_VALUE: "kept"
    });
  });
});
