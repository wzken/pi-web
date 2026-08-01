import {
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderHeart,
  FolderOpen,
  Home,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isAbortError, jsonBody } from "./api";
import { Button, Dialog, IconButton } from "./components";
import { t } from "./i18n";
import { ui } from "./ui";

interface BrowseDirectoryResponse {
  root: string;
  path: string;
  absolutePath: string;
  entries: Array<{
    name: string;
    path: string;
    directory: true;
  }>;
}

export function DirectoryPicker({
  roots,
  value,
  disabled = false,
  onChange
}: {
  roots: string[];
  value: string;
  disabled?: boolean;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState(roots[0] ?? "");
  const [relativePath, setRelativePath] = useState("");
  const [current, setCurrent] = useState<BrowseDirectoryResponse | null>(null);
  const [favorite, setFavorite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState("");
  const loadGeneration = useRef(0);
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async (nextRoot: string, nextPath: string) => {
    if (!nextRoot) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const generation = ++loadGeneration.current;
    setBusy(true);
    setError("");
    setCurrent(null);
    try {
      const response = await api<BrowseDirectoryResponse>(
        `/api/directories/browse?root=${encodeURIComponent(nextRoot)}&path=${encodeURIComponent(nextPath)}`,
        { signal: controller.signal }
      );
      if (generation !== loadGeneration.current) return;
      setRoot(nextRoot);
      setRelativePath(response.path);
      setCurrent(response);
    } catch (reason) {
      if (generation === loadGeneration.current && !isAbortError(reason)) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (generation === loadGeneration.current) {
        setBusy(false);
        if (loadController.current === controller) loadController.current = null;
      }
    }
  }, []);

  useEffect(
    () => () => {
      loadController.current?.abort();
    },
    []
  );

  const crumbs = useMemo(() => {
    const segments = relativePath.split(/[\\/]/).filter(Boolean);
    return segments.map((name, index) => ({
      name,
      path: segments.slice(0, index + 1).join("/")
    }));
  }, [relativePath]);

  async function choose() {
    if (!current || choosing) return;
    setChoosing(true);
    setError("");
    try {
      if (favorite) {
        await api("/api/directories/favorite", {
          method: "PUT",
          ...jsonBody({
            path: current.absolutePath,
            favorite: true
          })
        });
      }
      onChange(current.absolutePath);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChoosing(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        className={ui("directory-picker-trigger")}
        variant="toolbar"
        size="sm"
        disabled={disabled || roots.length === 0}
        tooltip={roots.length === 0 ? t("先在设置中配置允许目录") : t("浏览工作目录")}
        onClick={() => {
          const matchingRoot =
            roots.find((candidate) =>
              pathBelongsToRoot(value, candidate)
            ) ?? roots[0] ?? "";
          setRoot(matchingRoot);
          setRelativePath("");
          setOpen(true);
          void load(matchingRoot, "");
        }}
      >
        <FolderOpen size={15} />
        <span>{value ? compactPath(value) : t("选择目录")}</span>
      </Button>

      <Dialog
        open={open}
        labelledBy="directory-picker-title"
        className={ui("directory-picker-dialog")}
        maxWidth={620}
        onClose={() => {
          if (!choosing) {
            loadController.current?.abort();
            setOpen(false);
          }
        }}
      >
        <header className={ui("dialog-heading")}>
          <div>
            <p className={ui("eyebrow")}>WORKSPACE</p>
            <h2 id="directory-picker-title">{t("选择工作目录")}</h2>
          </div>
          <IconButton
            label={t("关闭目录选择")}
            disabled={choosing}
            onClick={() => setOpen(false)}
          >
            <X size={17} />
          </IconButton>
        </header>

        <label className={ui("field")}>
          <span>{t("允许的根目录")}</span>
          <select
            value={root}
            disabled={busy || choosing}
            onChange={(event) => {
              void load(event.target.value, "");
            }}
          >
            {roots.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        <nav className={ui("directory-breadcrumbs")} aria-label={t("当前目录")}>
          <IconButton
            label={t("返回上级")}
            size="sm"
            disabled={!relativePath || busy || choosing}
            onClick={() => {
              const segments = relativePath.split(/[\\/]/).filter(Boolean);
              void load(root, segments.slice(0, -1).join("/"));
            }}
          >
            <ChevronLeft size={14} />
          </IconButton>
          <button
            type="button"
            disabled={busy || choosing}
            onClick={() => void load(root, "")}
          >
            <Home size={13} />
          </button>
          {crumbs.map((crumb) => (
            <button
              type="button"
              key={crumb.path}
              disabled={busy || choosing}
              onClick={() => void load(root, crumb.path)}
            >
              <ChevronRight size={12} />
              {crumb.name}
            </button>
          ))}
        </nav>

        <div className={ui("directory-browser")} aria-busy={busy}>
          {current?.entries.map((entry) => (
            <button
              type="button"
              key={entry.path}
              disabled={busy || choosing}
              onDoubleClick={() => void load(root, entry.path)}
              onClick={() => void load(root, entry.path)}
            >
              <Folder size={16} />
              <span>{entry.name}</span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!busy && current?.entries.length === 0 && (
            <p>{t("这个目录没有子文件夹，可以直接选择它。")}</p>
          )}
          {busy && <p>{t("正在读取目录…")}</p>}
        </div>

        {error && <p className={ui("session-folder-error")} role="alert">{error}</p>}

        <label className={ui("directory-favorite")}>
          <input
            type="checkbox"
            checked={favorite}
            disabled={choosing}
            onChange={(event) => setFavorite(event.target.checked)}
          />
          <FolderHeart size={15} />
          {t("添加到常用目录")}
        </label>

        <footer className={ui("dialog-actions")}>
          <Button
            variant="secondary"
            disabled={choosing}
            onClick={() => setOpen(false)}
          >
            {t("取消")}
          </Button>
          <Button
            disabled={!current || busy || choosing}
            loading={choosing}
            loadingLabel={t("选择中…")}
            leftIcon={<Check size={15} />}
            onClick={() => void choose()}
          >
            {t("选择此目录")}
          </Button>
        </footer>
      </Dialog>
    </>
  );
}

function compactPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}

export function pathBelongsToRoot(path: string, root: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  const candidate = normalize(path);
  const boundary = normalize(root);
  return candidate === boundary || candidate.startsWith(`${boundary}/`);
}
