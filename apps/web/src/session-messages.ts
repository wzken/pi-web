import type {
  PiMessage,
  PromptImage,
  SessionStatus
} from "@pi-web/protocol";
import { isSupportedPromptImageMimeType } from "@pi-web/protocol/prompt-images";

export interface RetryablePrompt {
  message: string;
  images: PromptImage[];
}

export function extractRetryablePrompt(
  messages: PiMessage[],
  status: SessionStatus
): RetryablePrompt | null {
  if (!["failed", "interrupted"].includes(status)) return null;
  const last = messages.at(-1);
  if (!last || last.role !== "user") return null;
  return messageToPrompt(last);
}

export function extractLastUserPrompt(
  messages: PiMessage[]
): RetryablePrompt | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return messageToPrompt(message);
  }
  return null;
}

function messageToPrompt(message: PiMessage): RetryablePrompt | null {
  if (typeof message.content === "string") {
    return message.content.trim()
      ? { message: message.content, images: [] }
      : null;
  }
  const text = message.content
    .filter(
      (block) => block.type === "text" && typeof block.text === "string"
    )
    .map((block) => String(block.text))
    .join("\n")
    .trim();
  const images = message.content.flatMap((block): PromptImage[] => {
    if (
      block.type !== "image" ||
      typeof block.data !== "string" ||
      typeof block.mimeType !== "string" ||
      !isSupportedPromptImageMimeType(block.mimeType)
    ) {
      return [];
    }
    return [
      {
        type: "image",
        mimeType: block.mimeType,
        data: block.data
      }
    ];
  });
  return text || images.length > 0 ? { message: text, images } : null;
}
