import type { PromptImage } from "@pi-web/protocol";
import {
  base64ByteLength,
  isSupportedPromptImageMimeType,
  maxPromptImageBytes,
  maxPromptImages,
  maxPromptImagesTotalBytes
} from "@pi-web/protocol/prompt-images";

export interface ImageDraftItem extends PromptImage {
  id: string;
  name: string;
  size: number;
}

interface ImageDraftRecord {
  scope: string;
  images: ImageDraftItem[];
  updatedAt: string;
}

const databaseName = "pi-web-drafts";
const storeName = "image-attachments";
const databaseVersion = 1;

export async function readImageDraft(scope: string): Promise<ImageDraftItem[]> {
  if (!scope || typeof indexedDB === "undefined") return [];
  try {
    const database = await openDatabase();
    const record = await requestResult<ImageDraftRecord | undefined>(
      database
        .transaction(storeName, "readonly")
        .objectStore(storeName)
        .get(scope)
    );
    database.close();
    return sanitizeImages(record?.images);
  } catch {
    return [];
  }
}

function sanitizeImages(value: unknown): ImageDraftItem[] {
  if (!Array.isArray(value)) return [];
  const images: ImageDraftItem[] = [];
  let totalBytes = 0;
  for (const item of value.slice(0, maxPromptImages)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      record.type !== "image" ||
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.size !== "number" ||
      typeof record.mimeType !== "string" ||
      !isSupportedPromptImageMimeType(record.mimeType) ||
      typeof record.data !== "string"
    ) {
      continue;
    }
    const bytes = base64ByteLength(record.data);
    if (bytes > maxPromptImageBytes) continue;
    totalBytes += bytes;
    if (totalBytes > maxPromptImagesTotalBytes) break;
    images.push({
      id: record.id,
      name: record.name,
      size: record.size,
      type: "image",
      mimeType: record.mimeType,
      data: record.data
    });
  }
  return images;
}

export async function writeImageDraft(
  scope: string,
  images: ImageDraftItem[]
): Promise<void> {
  if (!scope || typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    if (images.length === 0) {
      store.delete(scope);
    } else {
      store.put({
        scope,
        images,
        updatedAt: new Date().toISOString()
      } satisfies ImageDraftRecord);
    }
    await transactionDone(transaction);
    database.close();
  } catch {
    // Attachment drafts are best-effort; the in-memory composer remains usable.
  }
}

export async function clearImageDraft(scope: string): Promise<void> {
  await writeImageDraft(scope, []);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: "scope" });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Unable to open attachment drafts"))
    );
    request.addEventListener("blocked", () =>
      reject(new Error("Attachment draft database is blocked"))
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Attachment draft request failed"))
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Attachment draft transaction aborted"))
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Attachment draft transaction failed"))
    );
  });
}
