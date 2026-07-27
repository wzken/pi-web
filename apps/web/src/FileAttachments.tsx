import { FileText, Paperclip, X } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { api, jsonBody } from "./api";
import { IconButton } from "./components";
import {
  appendImageFiles,
  formatFileSize,
  readFileAsBase64,
  type PendingImage
} from "./ImageAttachments";
import { t } from "./i18n";
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

export function AttachmentPicker({
  images,
  files,
  disabled = false,
  onImagesChange,
  onFilesChange,
  onError
}: {
  images: PendingImage[];
  files: PendingFileAttachment[];
  disabled?: boolean;
  onImagesChange: (images: PendingImage[]) => void;
  onFilesChange: (files: PendingFileAttachment[]) => void;
  onError: (error: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(selected: File[]) {
    try {
      const imageFiles = selected.filter((file) => file.type.startsWith("image/"));
      const generalFiles = selected.filter(
        (file) => !file.type.startsWith("image/")
      );
      if (imageFiles.length > 0) {
        onImagesChange(await appendImageFiles(images, imageFiles));
      }
      if (generalFiles.length > 0) {
        onFilesChange(appendGeneralFiles(files, generalFiles));
      }
    } catch (error) {
      onError(error);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length > 0) void addFiles(selected);
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
        label={t("添加附件")}
        tooltip={t("添加图片、代码、文档或日志")}
        variant="toolbar"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={15} />
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
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      file,
      name: file.name || "attachment",
      size: file.size
    }))
  ];
}
