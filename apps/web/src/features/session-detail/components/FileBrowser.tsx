import {
  ChevronRight,
  Copy,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  X
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isAbortError } from "../../../api";
import {
  ActionMenu,
  ActionMenuItem,
  ErrorBanner,
  IconButton,
  Loading,
  useToast
} from "../../../components";
import type {
  FileEntry,
  FileList,
  SelectedFile
} from "../types";
import { formatBytes } from "../utils/session-formatting";
import {
  FileMutationDialog,
  type FileMutation,
  type FileMutationResult
} from "./FileMutationDialog";
import { FileIcon, FilePreview } from "./FilePreview";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface FileBrowserProps {
  sessionId: string;
  cwd: string;
  onClose: () => void;
  compact?: boolean;
}

export function FileBrowser({
  sessionId,
  cwd,
  onClose,
  compact = false
}: FileBrowserProps) {
  const [path, setPath] = useState("");
  const [list, setList] = useState<FileList | null>(null);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mutation, setMutation] = useState<FileMutation | null>(null);
  const previewRequest = useRef(0);
  const previewController = useRef<AbortController | null>(null);
  const toast = useToast();

  const load = useCallback(
    async (signal?: AbortSignal) =>
      await api<FileList>(
        `/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`,
        signal ? { signal } : {}
      ),
    [path, sessionId]
  );

  useEffect(() => {
    const controller = new AbortController();
    setList(null);
    setError(null);
    void load(controller.signal)
      .then(setList)
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, [load]);

  useEffect(
    () => () => {
      previewController.current?.abort();
    },
    []
  );

  async function openEntry(entry: FileEntry) {
    const request = ++previewRequest.current;
    previewController.current?.abort();
    if (entry.directory) {
      setSelected(null);
      setPath(entry.path);
      return;
    }
    setError(null);
    if (entry.preview !== "text") {
      setSelected({ entry });
      return;
    }
    const controller = new AbortController();
    previewController.current = controller;
    try {
      const result = await api<{ content: string }>(
        `/api/sessions/${sessionId}/file-text?path=${encodeURIComponent(entry.path)}`,
        { signal: controller.signal }
      );
      if (previewRequest.current === request) {
        setSelected({ entry, content: result.content });
      }
    } catch (reason) {
      if (previewRequest.current === request && !isAbortError(reason)) {
        setError(reason);
      }
    } finally {
      if (previewController.current === controller) {
        previewController.current = null;
      }
    }
  }

  async function refreshList() {
    setList(await load());
  }

  async function completeMutation(
    result: FileMutationResult,
    completedMutation: FileMutation
  ) {
    if (
      completedMutation.type === "rename" &&
      selected?.entry.path === completedMutation.entry.path
    ) {
      setSelected(null);
    }
    try {
      await refreshList();
    } catch (reason) {
      setError(reason);
    }
    toast.push(
      completedMutation.type === "rename"
        ? t("已重命名为 {{name}}", { name: result.name })
        : t("已创建{{type}} {{name}}", {
            type: result.directory ? t("文件夹") : t("文件"),
            name: result.name
          })
    );
  }

  async function copyPath(entry: FileEntry) {
    try {
      await navigator.clipboard.writeText(entry.path.replaceAll("\\", "/"));
      toast.push(t("相对路径已复制"));
    } catch (reason) {
      setError(reason);
    }
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  return (
    <div className={ui(`file-browser${compact ? " file-browser-compact" : ""}`)}>
      <header className={ui("file-header")}>
        <div>
          <p className={ui("eyebrow")}>WORKSPACE</p>
          <h2>{t("文件")}</h2>
        </div>
        <div className={ui("file-header-actions")}>
          <ActionMenu label={t("新建文件或文件夹")}>
            <ActionMenuItem
              onClick={() =>
                setMutation({ type: "create-file", directoryPath: path })
              }
            >
              <FilePlus2 size={14} />
              {t("新建文件")}
            </ActionMenuItem>
            <ActionMenuItem
              onClick={() =>
                setMutation({ type: "create-directory", directoryPath: path })
              }
            >
              <FolderPlus size={14} />
              {t("新建文件夹")}
            </ActionMenuItem>
          </ActionMenu>
          <IconButton className={ui("mobile-only")} onClick={onClose} label={t("关闭文件")}>
            <X size={18} />
          </IconButton>
        </div>
      </header>
      <div className={ui("file-root")} title={cwd}>
        <FolderOpen size={15} />
        <span>{cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd}</span>
      </div>
      <div className={ui("breadcrumbs")}>
        <button onClick={() => setPath("")}>root</button>
        {segments.map((segment, index) => (
          <span key={`${segment}-${index}`}>
            <ChevronRight size={12} />
            <button
              onClick={() => setPath(segments.slice(0, index + 1).join("/"))}
            >
              {segment}
            </button>
          </span>
        ))}
      </div>

      {error !== null && (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      )}
      {!list ? (
        <Loading label={t("读取目录")} />
      ) : (
        <div className={ui("file-list")}>
          {path && (
            <button
              className={ui("file-row")}
              onClick={() =>
                setPath(
                  path
                    .split(/[\\/]/)
                    .filter(Boolean)
                    .slice(0, -1)
                    .join("/")
                )
              }
            >
              <Folder size={16} />
              <span>..</span>
            </button>
          )}
          {list.entries.map((entry) => (
            <div className={ui("file-row-shell")} key={entry.path}>
              <button
                className={ui(`file-row ${
                  selected?.entry.path === entry.path ? "selected" : ""
                }`)}
                onClick={() => void openEntry(entry)}
              >
                <FileIcon entry={entry} />
                <span title={entry.name}>{entry.name}</span>
                {!entry.directory && <small>{formatBytes(entry.size)}</small>}
              </button>
              <ActionMenu label={t("文件操作 {{name}}", { name: entry.name })}>
                <ActionMenuItem onClick={() => void copyPath(entry)}>
                  <Copy size={14} />
                  {t("复制相对路径")}
                </ActionMenuItem>
                <ActionMenuItem
                  onClick={() => setMutation({ type: "rename", entry })}
                >
                  <Pencil size={14} />
                  {t("重命名")}
                </ActionMenuItem>
              </ActionMenu>
            </div>
          ))}
          {list.truncated && (
            <div className={ui("file-limit")}>{t("目录过大，仅显示前 2000 项")}</div>
          )}
        </div>
      )}
      {selected && (
        <FilePreview
          sessionId={sessionId}
          selected={selected}
          onClose={() => setSelected(null)}
        />
      )}
      <FileMutationDialog
        sessionId={sessionId}
        mutation={mutation}
        onClose={() => setMutation(null)}
        onCompleted={completeMutation}
        onError={setError}
      />
    </div>
  );
}
