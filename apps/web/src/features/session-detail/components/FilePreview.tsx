import {
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  Maximize2,
  X
} from "lucide-react";
import { ButtonLink, IconButton } from "../../../components";
import type { FileEntry, SelectedFile } from "../types";
import { formatBytes } from "../utils/session-formatting";
import { Markdown } from "./Markdown";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

export function FilePreview({
  sessionId,
  selected,
  onClose
}: {
  sessionId: string;
  selected: SelectedFile;
  onClose: () => void;
}) {
  const { entry, content } = selected;
  const raw = `/api/sessions/${sessionId}/file-raw?path=${encodeURIComponent(
    entry.path
  )}`;
  const markdown =
    entry.name.endsWith(".md") || entry.name.endsWith(".markdown");
  return (
    <div className={ui("file-preview")}>
      <header>
        <div>
          <strong>{entry.name}</strong>
          <span>
            {entry.mime ?? "application/octet-stream"} ·{" "}
            {formatBytes(entry.size)}
          </span>
        </div>
        <div>
          <ButtonLink
            to={raw}
            variant="toolbar"
            size="icon"
            target="_blank"
            rel="noopener noreferrer"
            tooltip={t("新窗口打开")}
            aria-label={t("新窗口打开")}
          >
            <Maximize2 size={15} />
          </ButtonLink>
          <IconButton
            variant="toolbar"
            onClick={onClose}
            label={t("关闭预览")}
          >
            <X size={16} />
          </IconButton>
        </div>
      </header>
      <div className={ui("preview-body")}>
        {entry.preview === "text" && content !== undefined ? (
          markdown ? (
            <Markdown>{content}</Markdown>
          ) : (
            <pre className={ui("code-preview")}>{content}</pre>
          )
        ) : entry.preview === "image" ? (
          <img src={raw} alt={entry.name} />
        ) : entry.preview === "audio" ? (
          <audio controls src={raw} />
        ) : entry.preview === "video" ? (
          <video controls src={raw} />
        ) : entry.preview === "pdf" ? (
          <iframe src={raw} title={entry.name} sandbox="" />
        ) : (
          <div className={ui("download-only")}>
            <File size={28} />
            <p>{t("浏览器无法安全预览此格式。")}</p>
            <a className={ui("button button-secondary")} href={`${raw}&download=1`}>
              {t("下载文件")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function FileIcon({ entry }: { entry: FileEntry }) {
  if (entry.directory) return <Folder size={16} />;
  if (entry.preview === "image") return <FileImage size={16} />;
  if (entry.preview === "text") {
    return /\.(?:ts|tsx|js|jsx|py|go|rs|java|c|cpp|css)$/i.test(entry.name) ? (
      <FileCode2 size={16} />
    ) : (
      <FileText size={16} />
    );
  }
  return <File size={16} />;
}
