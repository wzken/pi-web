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
    <section
      className={ui(
        `file-preview file-preview-pane file-preview-kind-${entry.preview}`
      )}
    >
      <header className={ui("file-preview-header")}>
        <div className={ui("file-preview-heading")}>
          <span className={ui("file-preview-location")} title={entry.path}>
            {entry.path.replaceAll("\\", "/")}
          </span>
          <strong className={ui("file-preview-title")}>{entry.name}</strong>
          <span className={ui("file-preview-meta")}>
            {entry.mime ?? "application/octet-stream"} ·{" "}
            {formatBytes(entry.size)}
          </span>
        </div>
        <div className={ui("file-preview-actions")}>
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
      <div className={ui("preview-body file-preview-canvas")}>
        {entry.preview === "text" && content !== undefined ? (
          markdown ? (
            <div className={ui("file-preview-document file-preview-markdown")}>
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <pre className={ui("code-preview file-preview-code")}>
              {content}
            </pre>
          )
        ) : entry.preview === "image" ? (
          <img
            className={ui("file-preview-media file-preview-image")}
            src={raw}
            alt={entry.name}
          />
        ) : entry.preview === "audio" ? (
          <audio
            className={ui("file-preview-media file-preview-audio")}
            controls
            src={raw}
          />
        ) : entry.preview === "video" ? (
          <video
            className={ui("file-preview-media file-preview-video")}
            controls
            src={raw}
          />
        ) : entry.preview === "pdf" ? (
          <iframe
            className={ui("file-preview-frame")}
            src={raw}
            title={entry.name}
            sandbox=""
          />
        ) : (
          <div className={ui("download-only file-preview-download")}>
            <File size={28} />
            <p>{t("浏览器无法安全预览此格式。")}</p>
            <a className={ui("button button-secondary")} href={`${raw}&download=1`}>
              {t("下载文件")}
            </a>
          </div>
        )}
      </div>
    </section>
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
