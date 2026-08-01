import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const sessionIndex = args.indexOf("--session");
const systemPromptIndex = args.indexOf("--append-system-prompt");
const systemPrompt =
  systemPromptIndex >= 0 && args[systemPromptIndex + 1]
    ? args[systemPromptIndex + 1]
    : "";
const sessionFile =
  sessionIndex >= 0 && args[sessionIndex + 1]
    ? args[sessionIndex + 1]
    : process.env.PI_WEB_FAKE_SESSION_FILE ||
      join(
        process.env.PI_WEB_FAKE_SESSION_DIR || tmpdir(),
        `.fake-pi-${process.pid}.jsonl`
      );
const sessionId = randomUUID();
let model = { provider: "fake", id: "deterministic", name: "Fake Pi" };
let thinkingLevel = "medium";
let messages = [];
let parentId = null;
let buffer = "";
let aborted = false;
let streaming = false;
let delayedInitialState = false;
const steeringQueue = [];
const followUpQueue = [];

if (!existsSync(sessionFile)) {
  mkdirSync(dirname(sessionFile), { recursive: true });
  writeFileSync(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd()
    })}\n`
  );
} else {
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message") {
        messages.push(entry.message);
        parentId = entry.id;
      }
    } catch {}
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
    newline = buffer.indexOf("\n");
  }
});

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function response(command, request, data) {
  send({
    type: "response",
    command,
    success: true,
    ...(request.id ? { id: request.id } : {}),
    ...(data === undefined ? {} : { data })
  });
}

function appendMessage(message) {
  const id = randomUUID().slice(0, 8);
  appendFileSync(
    sessionFile,
    `${JSON.stringify({
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message
    })}\n`
  );
  parentId = id;
  messages.push(message);
}

function handle(request) {
  switch (request.type) {
    case "get_state": {
      const respondWithState = () =>
        response("get_state", request, {
          model,
          thinkingLevel,
          isStreaming: streaming,
          isCompacting: false,
          sessionFile,
          sessionId,
          sessionName: "Fake Pi",
          systemPrompt: systemPrompt
            ? `You are Pi, a coding agent.\n\n${systemPrompt}`
            : "You are Pi, a coding agent.",
          messageCount: messages.length,
          pendingMessageCount: steeringQueue.length + followUpQueue.length
        });
      const delay = Number(process.env.PI_WEB_FAKE_START_DELAY_MS || 0);
      if (!delayedInitialState && delay > 0) {
        delayedInitialState = true;
        setTimeout(respondWithState, delay);
      } else {
        respondWithState();
      }
      break;
    }
    case "get_messages":
      response("get_messages", request, { messages });
      break;
    case "get_session_stats": {
      const assistantMessages = messages.filter(
        (message) => message.role === "assistant"
      ).length;
      const userMessages = messages.filter(
        (message) => message.role === "user"
      ).length;
      const input = assistantMessages * 12;
      const output = assistantMessages * 7;
      const cacheRead = assistantMessages * 2;
      const total = input + output + cacheRead;
      response("get_session_stats", request, {
        sessionFile,
        sessionId,
        userMessages,
        assistantMessages,
        toolCalls: assistantMessages,
        toolResults: assistantMessages,
        totalMessages: messages.length,
        tokens: {
          input,
          output,
          cacheRead,
          cacheWrite: 0,
          total
        },
        cost: assistantMessages * 0.001,
        contextUsage: {
          tokens: total,
          contextWindow: 200_000,
          percent: (total / 200_000) * 100
        }
      });
      break;
    }
    case "get_available_models":
      response("get_available_models", request, {
        models: [
          { provider: "fake", id: "deterministic", name: "Fake Pi" },
          { provider: "fake", id: "switched", name: "Fake Pi switched" }
        ]
      });
      break;
    case "set_model":
      model = { provider: request.provider, id: request.modelId, name: request.modelId };
      response("set_model", request, model);
      break;
    case "set_thinking_level":
      thinkingLevel = request.level;
      response("set_thinking_level", request);
      break;
    case "abort":
      aborted = true;
      streaming = false;
      response("abort", request);
      send({ type: "agent_settled", messages });
      break;
    case "prompt":
      response(request.type, request);
      runTurn(String(request.message || ""));
      break;
    case "steer":
    case "follow_up": {
      response(request.type, request);
      const queue = request.type === "steer" ? steeringQueue : followUpQueue;
      queue.push(String(request.message || ""));
      emitQueue();
      if (!streaming) continueQueuedTurn();
      break;
    }
    default:
      send({
        type: "response",
        command: request.type,
        success: false,
        id: request.id,
        error: `Unsupported command: ${request.type}`
      });
  }
}

function runTurn(text) {
  aborted = false;
  streaming = true;
  appendMessage({ role: "user", content: text });
  send({ type: "agent_start" });
  send({ type: "turn_start" });
  send({ type: "message_start", message: { role: "assistant", content: [] } });
  if (text.includes("invalid")) {
    process.stdout.write("{this is not valid JSON}\n");
  }
  if (text.includes("extension-error")) {
    send({
      type: "extension_error",
      extensionPath: "fake-extension.ts",
      error: "synthetic extension failure"
    });
  }
  if (text.includes("crash")) {
    setTimeout(() => process.exit(23), 35);
    return;
  }
  if (text.includes("tool")) {
    send({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" } });
    send({
      type: "tool_execution_update",
      toolCallId: "tool-1",
      toolName: "read",
      partialResult: { content: "reading" }
    });
  }
  if (text.includes("hang")) return;
  const delay = text.includes("slow") ? 450 : 35;
  setTimeout(() => {
    if (aborted) return;
    send({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Fake Pi is working…" }
    });
    if (text.includes("tool")) {
      send({
        type: "tool_execution_end",
        toolCallId: "tool-1",
        toolName: "read",
        result: { content: "ok" },
        isError: false
      });
    }
    const message = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: text.includes("long")
            ? `Completed: ${"x".repeat(200_000)}`
            : `Completed: ${text}`
        }
      ],
      provider: model.provider,
      model: model.id,
      usage: {
        input: 12,
        output: 7,
        cacheRead: 2,
        cost: { total: 0.001 }
      },
      stopReason: "stop"
    };
    if (text.includes("event-before-persist")) {
      // Match Pi's real ordering: listeners see message_end before
      // SessionManager appends the finalized message. Blocking here makes the
      // cross-process race deterministic while queued RPC commands remain a
      // valid persistence barrier.
      send({ type: "message_end", message });
      const persistAfter = Date.now() + 40;
      while (Date.now() < persistAfter) {
        // Intentionally hold the fake Pi event handler.
      }
      appendMessage(message);
    } else {
      appendMessage(message);
      send({ type: "message_end", message });
    }
    send({ type: "turn_end", message });
    send({ type: "agent_end", messages });
    continueQueuedTurn();
  }, delay);
}

function continueQueuedTurn() {
  const next = steeringQueue.shift() ?? followUpQueue.shift();
  emitQueue();
  if (next !== undefined) {
    runTurn(next);
    return;
  }
  streaming = false;
  send({ type: "agent_settled", messages });
}

function emitQueue() {
  send({
    type: "queue_update",
    steering: [...steeringQueue],
    followUp: [...followUpQueue]
  });
}
