import { ImagePlus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent
} from "react";
import {
  maxPromptImageBytes,
  maxPromptImages,
  maxPromptImagesTotalBytes,
  supportedPromptImageMimeTypes,
  isSupportedPromptImageMimeType
} from "@pi-web/protocol/prompt-images";
import { IconButton } from "./components";
import {
  clearImageDraft,
  readImageDraft,
  writeImageDraft,
  type ImageDraftItem
} from "./image-draft-store";
import { t } from "./i18n";
import { ui } from "./ui";

export type PendingImage = ImageDraftItem;

export function useImageAttachmentDraft(scope: string) {
  const [images, setStoredImages] = useState<PendingImage[]>([]);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const revision = useRef(0);

  const setImages = useCallback((next: PendingImage[]) => {
    revision.current += 1;
    setStoredImages(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAtRevision = revision.current;
    setLoadedScope(null);
    setStoredImages([]);
    void readImageDraft(scope).then((stored) => {
      if (cancelled) return;
      if (revision.current === startedAtRevision) setStoredImages(stored);
      setLoadedScope(scope);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  useEffect(() => {
    if (loadedScope !== scope) return;
    void writeImageDraft(scope, images);
  }, [images, loadedScope, scope]);

  const clear = useCallback(async () => {
    revision.current += 1;
    setStoredImages([]);
    await clearImageDraft(scope);
  }, [scope]);

  return { images, setImages, clear, ready: loadedScope === scope };
}

export async function appendImageFiles(
  current: PendingImage[],
  files: File[]
): Promise<PendingImage[]> {
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  if (imageFiles.length === 0) {
    throw new Error(t("请选择 PNG、JPEG、GIF 或 WebP 图片。"));
  }
  if (current.length + imageFiles.length > maxPromptImages) {
    throw new Error(t("每条消息最多添加 {{count}} 张图片。", {
      count: maxPromptImages
    }));
  }

  const nextSize =
    current.reduce((sum, image) => sum + image.size, 0) +
    imageFiles.reduce((sum, file) => sum + file.size, 0);
  if (nextSize > maxPromptImagesTotalBytes) {
    throw new Error(
      t("图片总大小不能超过 {{size}}。", {
        size: formatFileSize(maxPromptImagesTotalBytes)
      })
    );
  }

  const added = await Promise.all(
    imageFiles.map(async (file): Promise<PendingImage> => {
      if (!isSupportedPromptImageMimeType(file.type)) {
        throw new Error(t("{{name}}的格式不受支持。", {
          name: file.name || t("图片")
        }));
      }
      if (file.size > maxPromptImageBytes) {
        throw new Error(t("{{name}}超过 4.5 MB。", {
          name: file.name || t("图片")
        }));
      }
      return {
        id:
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
        name: file.name || t("粘贴的图片"),
        size: file.size,
        type: "image",
        mimeType: file.type,
        data: await readFileAsBase64(file)
      };
    })
  );
  return [...current, ...added];
}

export function ImageAttachmentPicker({
  images,
  disabled = false,
  onChange,
  onError
}: {
  images: PendingImage[];
  disabled?: boolean;
  onChange: (images: PendingImage[]) => void;
  onError: (error: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    try {
      onChange(await appendImageFiles(images, files));
    } catch (error) {
      onError(error);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) void addFiles(files);
  }

  return (
    <>
      <input
        ref={input}
        className={ui("visually-hidden")}
        type="file"
        accept={supportedPromptImageMimeTypes.join(",")}
        multiple
        disabled={disabled}
        onChange={selectFiles}
      />
      <IconButton
        label={t("添加图片")}
        tooltip={t("添加图片（最多 {{count}} 张）", {
          count: maxPromptImages
        })}
        variant="toolbar"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlus size={15} />
      </IconButton>
    </>
  );
}

export function ImageAttachmentTray({
  images,
  disabled = false,
  onChange
}: {
  images: PendingImage[];
  disabled?: boolean;
  onChange: (images: PendingImage[]) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className={ui("image-attachment-tray")} aria-label={t("待发送图片")}>
      {images.map((image) => (
        <figure className={ui("image-attachment")} key={image.id}>
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={image.name}
          />
          <figcaption title={image.name}>
            <span>{image.name}</span>
            <small>{formatFileSize(image.size)}</small>
          </figcaption>
          <IconButton
            label={t("移除图片 {{name}}", { name: image.name })}
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange(images.filter((item) => item.id !== image.id))
            }
          >
            <X size={12} />
          </IconButton>
        </figure>
      ))}
    </div>
  );
}

export async function readFileAsBase64(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0 || !result.slice(comma + 1)) {
        reject(new Error(t("无法读取图片 {{name}}", {
          name: file.name || ""
        }).trim()));
        return;
      }
      resolve(result.slice(comma + 1));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error(t("无法读取图片 {{name}}", {
        name: file.name || ""
      }).trim()))
    );
    reader.readAsDataURL(file);
  });
}

export function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
