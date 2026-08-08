import { FileText, Paperclip, Plus, X } from "lucide-react";
import { useCallback, useRef, type ChangeEvent } from "react";
import { api, jsonBody } from "./api";
import { IconButton } from "./components";
import {
  appendImageFiles,
  formatFileSize,
  readFileAsBase64,
  type PendingImage
} from "./ImageAttachments";
import { t } from "./i18n";
import { createMutationId } from "./mutation-id";
import { ui } from "./ui";

const maxFiles = 8;
const maxFileBytes = 16 * 1024 * 1024;
const maxFilesTotalBytes = 32 * 1024 * 1024;

export interface PendingFileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
}

interface UploadedAttachment {
  path: string;
  name: string;
  size: number;
}

interface AttachmentSelectionQueueOptions {
  active: () => boolean;
  getImages: () => PendingImage[];
  getFiles: () => PendingFileAttachment[];
  appendImages: (
    current: PendingImage[],
    selected: File[]
  ) => Promise<PendingImage[]>;
  appendFiles: (
    current: PendingFileAttachment[],
    selected: File[]
  ) => PendingFileAttachment[];
  setImages: (images: PendingImage[]) => void;
  setFiles: (files: PendingFileAttachment[]) => void;
}

export interface AttachmentSelectionQueue {
  add(selected: File[]): Promise<void>;
}

export function createAttachmentSelectionQueue({
  active,
  getImages,
  getFiles,
  appendImages,
  appendFiles,
  setImages,
  setFiles
}: AttachmentSelectionQueueOptions): AttachmentSelectionQueue {
  let tail = Promise.resolve();
  return {
    add(selected) {
      const operation = tail.then(async () => {
        if (!active()) return;
        const imageFiles = selected.filter((file) =>
          file.type.startsWith("image/")
        );
        const generalFiles = selected.filter(
          (file) => !file.type.startsWith("image/")
        );
        if (imageFiles.length > 0) {
          const base = getImages();
          const combined = await appendImages(base, imageFiles);
          if (!active()) return;
          const added = combined.slice(base.length);
          setImages([...getImages(), ...added]);
        }
        if (generalFiles.length > 0 && active()) {
          setFiles(appendFiles(getFiles(), generalFiles));
        }
      });
      tail = operation.catch(() => undefined);
      return operation;
    }
  };
}

export function useAttachmentSelectionQueue({
  scope,
  images,
  files,
  onImagesChange,
  onFilesChange,
  onError
}: {
  scope: string;
  images: PendingImage[];
  files: PendingFileAttachment[];
  onImagesChange: (images: PendingImage[]) => void;
  onFilesChange: (files: PendingFileAttachment[]) => void;
  onError: (error: unknown) => void;
}): (selected: File[]) => Promise<void> {
  const state = useRef({
    images,
    files,
    onImagesChange,
    onFilesChange,
    onError
  });
  state.current = {
    images,
    files,
    onImagesChange,
    onFilesChange,
    onError
  };
  const queue = useRef<{
    scope: string;
    value: AttachmentSelectionQueue;
  } | null>(null);
  if (queue.current?.scope !== scope) {
    const value = createAttachmentSelectionQueue({
      active: () => queue.current?.value === value,
      getImages: () => state.current.images,
      getFiles: () => state.current.files,
      appendImages: appendImageFiles,
      appendFiles: appendGeneralFiles,
      setImages: (next) => {
        state.current.images = next;
        state.current.onImagesChange(next);
      },
      setFiles: (next) => {
        state.current.files = next;
        state.current.onFilesChange(next);
      }
    });
    queue.current = { scope, value };
  }

  return useCallback((selected: File[]) => {
    const activeQueue = queue.current!.value;
    return activeQueue.add(selected).catch((error) => {
      if (queue.current?.value === activeQueue) state.current.onError(error);
    });
  }, []);
}

export function AttachmentPicker({
  disabled = false,
  className,
  visibleLabel = false,
  onAdd
}: {
  disabled?: boolean;
  className?: string;
  visibleLabel?: boolean;
  onAdd: (files: File[]) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length > 0) void onAdd(selected);
  }

  return (
    <>
      <input
        ref={input}
        className={ui("visually-hidden")}
        type="file"
        multiple
        disabled={disabled}
        onChange={selectFiles}
      />
      <IconButton
        className={className}
        label={t("添加附件")}
        tooltip={t("添加图片、代码、文档或日志")}
        variant="toolbar"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {visibleLabel ? (
          <Paperclip size={15} />
        ) : (
          <>
            <Paperclip
              className={ui("desktop-attachment-icon")}
              size={15}
            />
            <Plus className={ui("mobile-attachment-icon")} size={24} />
          </>
        )}
        {visibleLabel ? <span>{t("添加附件")}</span> : null}
      </IconButton>
    </>
  );
}

export function FileAttachmentTray({
  files,
  disabled = false,
  onChange
}: {
  files: PendingFileAttachment[];
  disabled?: boolean;
  onChange: (files: PendingFileAttachment[]) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className={ui("file-attachment-tray")} aria-label={t("待上传文件")}>
      {files.map((file) => (
        <div className={ui("file-attachment")} key={file.id}>
          <FileText size={15} />
          <span title={file.name}>{file.name}</span>
          <small>{formatFileSize(file.size)}</small>
          <IconButton
            label={t("移除附件 {{name}}", { name: file.name })}
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange(files.filter((item) => item.id !== file.id))
            }
          >
            <X size={12} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export async function uploadAttachments(
  cwd: string,
  files: PendingFileAttachment[]
): Promise<UploadedAttachment[]> {
  return await Promise.all(
    files.map(async (item) =>
      await api<UploadedAttachment>("/api/attachments", {
        method: "POST",
        ...jsonBody({
          mutationId: item.id,
          cwd,
          name: item.name,
          data: await readFileAsBase64(item.file)
        })
      })
    )
  );
}

export function appendAttachmentReferences(
  message: string,
  uploaded: UploadedAttachment[]
): string {
  if (uploaded.length === 0) return message;
  const references = uploaded.map((item) => `@${item.path}`).join("\n");
  return message.trim() ? `${message.trim()}\n\n${references}` : references;
}

function appendGeneralFiles(
  current: PendingFileAttachment[],
  selected: File[]
): PendingFileAttachment[] {
  if (current.length + selected.length > maxFiles) {
    throw new Error(t("每条消息最多添加 {{count}} 个普通文件。", {
      count: maxFiles
    }));
  }
  for (const file of selected) {
    if (file.size > maxFileBytes) {
      throw new Error(t("{{name}} 超过 {{size}}。", {
        name: file.name,
        size: formatFileSize(maxFileBytes)
      }));
    }
  }
  const total =
    current.reduce((sum, item) => sum + item.size, 0) +
    selected.reduce((sum, item) => sum + item.size, 0);
  if (total > maxFilesTotalBytes) {
    throw new Error(
      t("普通附件总大小不能超过 {{size}}。", {
        size: formatFileSize(maxFilesTotalBytes)
      })
    );
  }
  return [
    ...current,
    ...selected.map((file) => ({
      id: createMutationId(),
      file,
      name: file.name || "attachment",
      size: file.size
    }))
  ];
}
