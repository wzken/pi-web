export const supportedPromptImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
] as const;

export type PromptImageMimeType =
  (typeof supportedPromptImageMimeTypes)[number];

export interface PromptImage {
  type: "image";
  mimeType: PromptImageMimeType;
  data: string;
}

export const maxPromptImages = 16;
export const maxPromptImageBytes = Math.round(4.5 * 1024 * 1024);
export const maxPromptImagesTotalBytes = 24 * 1024 * 1024;
export const maxPromptRequestBytes =
  Math.ceil((maxPromptImagesTotalBytes * 4) / 3) + 2 * 1024 * 1024;

export function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function isSupportedPromptImageMimeType(
  value: string
): value is PromptImageMimeType {
  return (supportedPromptImageMimeTypes as readonly string[]).includes(value);
}
