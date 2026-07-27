import { randomUUID } from "node:crypto";
import { platform } from "node:os";
import { spawn as spawnPty } from "node-pty";
import { PiWebError } from "@pi-web/shared";

const maxTerminalBuffer = 1024 * 1024;

export interface TerminalProcess {
  readonly pid: number;
  readonly process: string;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(
    listener: (event: { exitCode: number; signal?: number }) => void
  ): { dispose(): void };
}

export interface TerminalPeer {
  send(message: TerminalServerMessage): void;
}

export type TerminalServerMessage =
  | {
      type: "ready";
      terminalId: string;
      sessionId: string;
      cwd: string;
      shell: string;
      pid: number;
      reconnected: boolean;
    }
  | { type: "data"; data: string; replay?: boolean }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; at: number };

export type SpawnTerminal = (
  shell: string,
  args: string[],
  options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
    useConptyDll?: boolean;
  }
) => TerminalProcess;

interface ManagedTerminal {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  process: TerminalProcess;
  peer: TerminalPeer | null;
  buffer: string;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  subscriptions: Array<{ dispose(): void }>;
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();

  constructor(
    private readonly spawnTerminal: SpawnTerminal = spawnPty as SpawnTerminal,
    private readonly options: {
      maxTerminals?: number;
      orphanTtlMs?: number;
    } = {}
  ) {}

  create(input: {
    sessionId: string;
    cwd: string;
    columns: number;
    rows: number;
    peer: TerminalPeer;
  }): string {
    if (this.terminals.size >= (this.options.maxTerminals ?? 4)) {
      throw new PiWebError(
        "TERMINAL_LIMIT",
        "Too many terminal processes are already running",
        429
      );
    }
    const shell = defaultShell();
    let process: TerminalProcess;
    try {
      process = this.spawnTerminal(shell, [], {
        name: "xterm-256color",
        cols: input.columns,
        rows: input.rows,
        cwd: input.cwd,
        env: terminalEnvironment(processEnvironment()),
        ...(platform() === "win32" ? { useConptyDll: true } : {})
      });
    } catch (error) {
      throw new PiWebError(
        "TERMINAL_START_FAILED",
        "The operating system could not start a terminal",
        500,
        error
      );
    }
    const id = randomUUID();
    const terminal: ManagedTerminal = {
      id,
      sessionId: input.sessionId,
      cwd: input.cwd,
      shell,
      process,
      peer: input.peer,
      buffer: "",
      cleanupTimer: null,
      subscriptions: []
    };
    terminal.subscriptions.push(
      process.onData((data) => this.receiveData(terminal, data)),
      process.onExit((event) => this.receiveExit(terminal, event))
    );
    this.terminals.set(id, terminal);
    input.peer.send(this.readyMessage(terminal, false));
    return id;
  }

  attach(input: {
    terminalId: string;
    sessionId: string;
    peer: TerminalPeer;
  }): void {
    const terminal = this.get(input.terminalId);
    if (terminal.sessionId !== input.sessionId) {
      throw new PiWebError(
        "TERMINAL_SESSION_MISMATCH",
        "Terminal does not belong to this Pi session",
        403
      );
    }
    if (terminal.peer) {
      throw new PiWebError(
        "TERMINAL_ALREADY_ATTACHED",
        "Terminal is already open in another browser view",
        409
      );
    }
    if (terminal.cleanupTimer) clearTimeout(terminal.cleanupTimer);
    terminal.cleanupTimer = null;
    terminal.peer = input.peer;
    input.peer.send(this.readyMessage(terminal, true));
    if (terminal.buffer) {
      input.peer.send({ type: "data", data: terminal.buffer, replay: true });
    }
  }

  write(terminalId: string, data: string): void {
    this.get(terminalId).process.write(data);
  }

  resize(terminalId: string, columns: number, rows: number): void {
    try {
      this.get(terminalId).process.resize(columns, rows);
    } catch (error) {
      throw new PiWebError(
        "TERMINAL_RESIZE_FAILED",
        "The terminal could not be resized",
        500,
        error
      );
    }
  }

  stop(terminalId: string): void {
    const terminal = this.get(terminalId);
    try {
      terminal.process.kill();
    } catch (error) {
      throw new PiWebError(
        "TERMINAL_STOP_FAILED",
        "The terminal process could not be stopped",
        500,
        error
      );
    }
  }

  detach(peer: TerminalPeer): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.peer !== peer) continue;
      terminal.peer = null;
      terminal.cleanupTimer = setTimeout(
        () => this.destroy(terminal),
        this.options.orphanTtlMs ?? 30_000
      );
    }
  }

  closeAll(): void {
    for (const terminal of [...this.terminals.values()]) {
      this.destroy(terminal);
    }
  }

  activeCount(): number {
    return this.terminals.size;
  }

  private receiveData(terminal: ManagedTerminal, data: string): void {
    terminal.buffer = `${terminal.buffer}${data}`.slice(-maxTerminalBuffer);
    terminal.peer?.send({ type: "data", data });
  }

  private receiveExit(
    terminal: ManagedTerminal,
    event: { exitCode: number; signal?: number }
  ): void {
    terminal.peer?.send({
      type: "exit",
      exitCode: event.exitCode,
      ...(event.signal === undefined ? {} : { signal: event.signal })
    });
    this.release(terminal);
  }

  private readyMessage(
    terminal: ManagedTerminal,
    reconnected: boolean
  ): TerminalServerMessage {
    return {
      type: "ready",
      terminalId: terminal.id,
      sessionId: terminal.sessionId,
      cwd: terminal.cwd,
      shell: terminal.shell,
      pid: terminal.process.pid,
      reconnected
    };
  }

  private get(id: string): ManagedTerminal {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new PiWebError(
        "TERMINAL_NOT_FOUND",
        "Terminal has ended or its reconnect window expired",
        404
      );
    }
    return terminal;
  }

  private destroy(terminal: ManagedTerminal): void {
    try {
      terminal.process.kill();
    } catch {
      // The process may have already ended.
    }
    this.release(terminal);
  }

  private release(terminal: ManagedTerminal): void {
    if (!this.terminals.delete(terminal.id)) return;
    if (terminal.cleanupTimer) clearTimeout(terminal.cleanupTimer);
    for (const subscription of terminal.subscriptions) subscription.dispose();
    terminal.subscriptions = [];
    terminal.peer = null;
  }
}

export function terminalEnvironment(
  source: NodeJS.ProcessEnv
): Record<string, string> {
  const blocked = new Set([
    "NODE_OPTIONS",
    "NODE_PATH",
    "PI_WEB_ACCESS_KEY",
    "PI_WEB_FAKE_PI"
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !blocked.has(entry[0].toUpperCase())
    )
  );
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor"
  };
}

function defaultShell(): string {
  if (platform() === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || "/bin/sh";
}
