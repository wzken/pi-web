import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Keyboard,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton, useToast } from "../../../components";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

type TerminalStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopping"
  | "exited"
  | "error";

type TerminalMessage =
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

export function TerminalPanel({
  sessionId,
  cwd,
  collapsed,
  onCollapse,
  onExpand,
  onClose
}: {
  sessionId: string;
  cwd: string;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalIdRef = useRef<string | null>(storedTerminalId(sessionId));
  const reconnectTimer = useRef<number | null>(null);
  const stopped = useRef(false);
  const stopRequested = useRef(false);
  const [status, setStatus] = useState<TerminalStatus>(
    terminalIdRef.current ? "connecting" : "idle"
  );
  const statusRef = useRef<TerminalStatus>(status);
  const [shell, setShell] = useState("");
  const [pid, setPid] = useState<number | null>(null);
  const [error, setError] = useState("");
  const toast = useToast();

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (collapsed) return;
    const frame = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // The mobile sheet may still be completing its layout transition.
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed]);

  const dimensions = useCallback(() => {
    const terminal = terminalRef.current;
    return {
      columns: Math.max(20, terminal?.cols ?? 80),
      rows: Math.max(5, terminal?.rows ?? 24)
    };
  }, []);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const style = getComputedStyle(document.documentElement);
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        style.getPropertyValue("--font-mono").trim() ||
        "\"SFMono-Regular\", Consolas, monospace",
      fontSize: window.matchMedia("(max-width: 760px)").matches ? 12 : 12.5,
      lineHeight: 1.2,
      minimumContrastRatio: 4.5,
      screenReaderMode: true,
      scrollback: 5000,
      theme: {
        background: cssColor(style, "--panel", "#111"),
        foreground: cssColor(style, "--text", "#eee"),
        cursor: cssColor(style, "--teal", "#5ce0c5"),
        selectionBackground: `${cssColor(style, "--teal", "#5ce0c5")}55`,
        black: cssColor(style, "--bg", "#111"),
        red: cssColor(style, "--red", "#ff7b73"),
        green: cssColor(style, "--teal", "#5ce0c5"),
        yellow: cssColor(style, "--amber", "#ffbf69"),
        blue: cssColor(style, "--blue", "#78b7ff"),
        magenta: cssColor(style, "--violet", "#a999ff"),
        cyan: cssColor(style, "--teal", "#5ce0c5"),
        white: cssColor(style, "--text", "#edf2ef")
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const inputSubscription = terminal.onData((data) => {
      if (statusRef.current === "connected") send({ type: "input", data });
    });
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        if (
          socketRef.current?.readyState === WebSocket.OPEN &&
          statusRef.current === "connected"
        ) {
          send({ type: "resize", ...dimensions() });
        }
      } catch {
        // The panel may be between layout states.
      }
    });
    observer.observe(host);
    window.setTimeout(() => fit.fit(), 0);
    return () => {
      observer.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [dimensions, send]);

  useEffect(() => {
    stopped.current = false;
    let retryMs = 500;

    function connect() {
      if (stopped.current) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/api/terminal`);
      socketRef.current = socket;
      if (terminalIdRef.current) setStatus("connecting");
      socket.addEventListener("open", () => {
        retryMs = 500;
        if (terminalIdRef.current) {
          send({
            type: "attach",
            terminalId: terminalIdRef.current,
            sessionId,
            ...dimensions()
          });
        } else {
          setStatus("idle");
        }
      });
      socket.addEventListener("message", (event) => {
        const message = parseTerminalMessage(event.data);
        if (!message) return;
        if (message.type === "ready") {
          stopRequested.current = false;
          terminalIdRef.current = message.terminalId;
          storeTerminalId(sessionId, message.terminalId);
          setShell(message.shell);
          setPid(message.pid);
          setError("");
          setStatus("connected");
          terminalRef.current?.focus();
        } else if (message.type === "data") {
          terminalRef.current?.write(message.data);
        } else if (message.type === "exit") {
          const exitLabel = stopRequested.current
            ? t("终端已停止")
            : t("进程已退出，代码 {{code}}", { code: message.exitCode });
          terminalRef.current?.writeln(`\r\n\x1b[90m[${exitLabel}]\x1b[0m`);
          stopRequested.current = false;
          terminalIdRef.current = null;
          removeTerminalId(sessionId);
          setPid(null);
          setStatus("exited");
        } else if (message.type === "error") {
          if (message.code === "TERMINAL_NOT_FOUND") {
            terminalIdRef.current = null;
            removeTerminalId(sessionId);
            setStatus("idle");
          } else {
            setStatus("error");
          }
          setError(message.message);
        }
      });
      socket.addEventListener("close", () => {
        if (stopped.current) return;
        socketRef.current = null;
        if (terminalIdRef.current) setStatus("reconnecting");
        reconnectTimer.current = window.setTimeout(connect, retryMs);
        retryMs = Math.min(5000, retryMs * 2);
      });
    }

    connect();
    return () => {
      stopped.current = true;
      if (reconnectTimer.current !== null) {
        window.clearTimeout(reconnectTimer.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [dimensions, send, sessionId]);

  function start() {
    terminalRef.current?.clear();
    setError("");
    if (send({ type: "start", sessionId, ...dimensions() })) {
      setStatus("connecting");
    } else {
      setError(t("终端连接尚未就绪"));
    }
  }

  function stop() {
    if (send({ type: "stop" })) {
      stopRequested.current = true;
      statusRef.current = "stopping";
      setStatus("stopping");
    }
  }

  async function copyOutput() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const selected = terminal.getSelection();
    const output =
      selected ||
      Array.from(
        { length: terminal.buffer.active.length },
        (_, index) =>
          terminal.buffer.active.getLine(index)?.translateToString(true) ?? ""
      )
        .join("\n")
        .trimEnd();
    if (!output) {
      toast.push(t("终端中没有可复制的输出"), "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
      toast.push(selected ? t("已复制选中内容") : t("已复制终端输出"));
    } catch (reason) {
      toast.push(
        reason instanceof Error ? reason.message : t("复制终端输出失败"),
        "error"
      );
    }
  }

  function sendKey(data: string) {
    if (status === "connected") {
      send({ type: "input", data });
      terminalRef.current?.focus();
    }
  }

  const active = ["connected", "reconnecting", "stopping"].includes(status);
  const launchPending =
    status === "connecting" && terminalIdRef.current === null;
  const panelId = `terminal-panel-${sessionId}`;
  return (
    <section
      id={panelId}
      className={ui(`terminal-panel${collapsed ? " is-collapsed" : ""}`)}
      aria-label={t("会话终端")}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <header>
        <div className={ui("terminal-heading")}>
          <TerminalSquare size={15} />
          <strong>{t("终端")}</strong>
          <span className={ui(`terminal-state terminal-state-${status}`)}>
            {statusLabel(status)}
          </span>
          {pid !== null && <small>PID {pid}</small>}
        </div>
        <div className={ui("terminal-actions")}>
          {collapsed ? (
            <IconButton
              variant="toolbar"
              label={t("展开终端")}
              aria-controls={panelId}
              aria-expanded={false}
              onClick={onExpand}
            >
              <ChevronUp size={16} />
            </IconButton>
          ) : (
            <>
              <IconButton
                variant="toolbar"
                label={t("复制终端输出")}
                onClick={() => void copyOutput()}
              >
                <Clipboard size={15} />
              </IconButton>
              <IconButton
                variant="toolbar"
                label={t("清空终端显示")}
                onClick={() => terminalRef.current?.clear()}
              >
                <Trash2 size={15} />
              </IconButton>
              {active && (
                <Button
                  variant="toolbar"
                  size="sm"
                  disabled={status === "stopping"}
                  onClick={stop}
                >
                  <Square size={13} />
                  {t("停止")}
                </Button>
              )}
              <IconButton
                className={ui("terminal-collapse-button")}
                variant="toolbar"
                label={t("缩回终端")}
                aria-controls={panelId}
                aria-expanded={true}
                onClick={onCollapse}
              >
                <ChevronDown size={16} />
              </IconButton>
            </>
          )}
          <IconButton variant="toolbar" label={t("关闭终端面板")} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </header>
      <div className={ui("terminal-meta")} title={cwd}>
        <span>{shell || t("系统默认 Shell")}</span>
        <code>{cwd}</code>
      </div>
      {error && (
        <div className={ui("terminal-error")} role="alert">
          {error}
        </div>
      )}
      <div className={ui("terminal-viewport")} ref={hostRef} />
      {(status === "idle" || status === "exited" || launchPending) && (
        <div className={ui("terminal-start")}>
          <TerminalSquare size={24} />
          <strong>
            {status === "exited"
              ? t("终端已结束")
              : launchPending
                ? t("正在启动终端")
                : t("启动工作区终端")}
          </strong>
          <p>
            {t("Shell 将以 Pi Web 系统用户权限运行，工作目录固定为当前会话目录。")}
          </p>
          <Button
            loading={launchPending}
            loadingLabel={t("启动中…")}
            disabled={launchPending}
            onClick={start}
          >
            {status === "exited" ? <RotateCcw size={15} /> : <TerminalSquare size={15} />}
            {status === "exited" ? t("重新启动") : t("启动终端")}
          </Button>
        </div>
      )}
      <footer className={ui("terminal-soft-keys")} aria-label={t("终端快捷键")}>
        <button type="button" onClick={() => terminalRef.current?.focus()}>
          <Keyboard size={14} />
          {t("键盘")}
        </button>
        <button type="button" onClick={() => sendKey("\x1b")}>Esc</button>
        <button type="button" onClick={() => sendKey("\t")}>Tab</button>
        <button type="button" onClick={() => sendKey("\x03")}>Ctrl+C</button>
        <button type="button" onClick={() => sendKey("\x0c")}>Ctrl+L</button>
        <button type="button" onClick={() => sendKey("\x1b[A")}>↑</button>
        <button type="button" onClick={() => sendKey("\x1b[B")}>↓</button>
      </footer>
    </section>
  );
}

function parseTerminalMessage(value: unknown): TerminalMessage | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as TerminalMessage;
    return parsed && typeof parsed === "object" && typeof parsed.type === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function statusLabel(status: TerminalStatus): string {
  return {
    idle: t("未启动"),
    connecting: t("连接中"),
    connected: t("已连接"),
    reconnecting: t("重连中"),
    stopping: t("停止中"),
    exited: t("已退出"),
    error: t("异常")
  }[status];
}

function storageKey(sessionId: string): string {
  return `pi-web-terminal:${sessionId}`;
}

function storedTerminalId(sessionId: string): string | null {
  try {
    return localStorage.getItem(storageKey(sessionId));
  } catch {
    return null;
  }
}

function storeTerminalId(sessionId: string, terminalId: string): void {
  try {
    localStorage.setItem(storageKey(sessionId), terminalId);
  } catch {
    // Reconnect remains available until this panel unmounts.
  }
}

function removeTerminalId(sessionId: string): void {
  try {
    localStorage.removeItem(storageKey(sessionId));
  } catch {
    // Nothing else needs to be cleaned up in the browser.
  }
}

function cssColor(
  style: CSSStyleDeclaration,
  variable: string,
  fallback: string
): string {
  return style.getPropertyValue(variable).trim() || fallback;
}
