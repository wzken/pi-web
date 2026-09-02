import type { PiContentBlock, PiMessage } from "@pi-web/protocol";
import { ui } from "../../../ui";
import { Markdown } from "./Markdown";

export function DiffCard({ text, title }: { text: string; title?: string }) {
  return (
    <div className={ui("diff-card")}>
      {title && <div className={ui("diff-card-title")}>{title}</div>}
      <Markdown>{`\`\`\`diff\n${text}\n\`\`\``}</Markdown>
    </div>
  );
}

function isUnifiedDiff(text: string): boolean {
  return (
    /^diff --git /m.test(text) ||
    (/^--- .+$/m.test(text) && /^\+\+\+ .+$/m.test(text))
  );
}

function addedFileDiff(path: string, content: string): string {
  const lines = content
    ? (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n")
    : [];
  return [
    "--- /dev/null",
    `+++ ${path}`,
    "@@ new file @@",
    ...lines.map((line) => `+${line}`)
  ].join("\n");
}

export function toolResultDiff(message: PiMessage, text: string): string | null {
  const patch = record(message.details)?.patch;
  if (typeof patch === "string") return patch;
  return isUnifiedDiff(text) ? text : null;
}

export function writeCallDiff(
  block: PiContentBlock
): { path: string; diff: string } | null {
  if (block.name !== "write") return null;
  const arguments_ = record(block.arguments);
  if (!arguments_) return null;
  const path = typeof arguments_.path === "string" ? arguments_.path : "";
  const content =
    typeof arguments_.content === "string" ? arguments_.content : null;
  return path && content !== null
    ? { path, diff: addedFileDiff(path, content) }
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
