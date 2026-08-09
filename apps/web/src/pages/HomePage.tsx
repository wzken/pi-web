import {
  ChevronDown,
  FolderOpen,
  Maximize2,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  SlidersHorizontal,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import type { SessionRecord, ThinkingLevel } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  Dialog,
  ErrorBanner,
  IconButton,
  Loading
} from "../components";
import { shouldSubmitComposerInput } from "../composer-input";
import { DirectoryPicker } from "../DirectoryPicker";
import { clearDraft, readDraft, writeDraft } from "../draft-store";
import {
  ImageAttachmentTray,
  useImageAttachmentDraft
} from "../ImageAttachments";
import {
  appendAttachmentReferences,
  AttachmentPicker,
  FileAttachmentTray,
  useAttachmentSelectionQueue,
  useAttachmentDropZone,
  uploadAttachments,
  type PendingFileAttachment
} from "../FileAttachments";
import { PendingMutationTracker } from "../mutation-id";
import { ModelSelect } from "../ModelSelect";
import { ThinkingLevelControl } from "../ThinkingLevelControl";
import { useNavigate, useSearchParams } from "../router";
import { SessionNavigator, useWorkbenchRail } from "../SessionNavigator";
import { useSessionList } from "../useSessionList";
import { t } from "../i18n";
import { ui } from "../ui";

interface DirectoryItem {
  path: string;
  alias: string | null;
  favorite: boolean;
  lastUsedAt: string;
}

interface HomeSettings {
  allowedRoots: string[];
  defaultModel: string | null;
  defaultThinkingLevel: ThinkingLevel | null;
  defaultSystemPrompt: string | null;
}

export function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedCwd = searchParams.get("cwd")?.trim() ?? "";
  const [railOpen, setRailOpen] = useWorkbenchRail();
  const {
    sessions,
    setSessions,
    error: sessionListError
  } = useSessionList();
  const [settings, setSettings] = useState<HomeSettings | null>(null);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | "">("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [files, setFiles] = useState<PendingFileAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [canExpandComposer, setCanExpandComposer] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [mobileViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 760px)").matches
      : false
  );
  const {
    images,
    setImages,
    clear: clearImages
  } = useImageAttachmentDraft(homeDraftScope(cwd));
  const queueAttachments = useAttachmentSelectionQueue({
    scope: homeDraftScope(cwd),
    images,
    files,
    onImagesChange: setImages,
    onFilesChange: setFiles,
    onError: setError
  });
  const createMutation = useRef(new PendingMutationTracker());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const addAttachments = useCallback(async (selected: File[]) => {
    setAttachmentBusy(true);
    try {
      await queueAttachments(selected);
    } finally {
      setAttachmentBusy(false);
    }
  }, [queueAttachments]);
  const { dragActive, dropZoneProps } = useAttachmentDropZone({
    disabled: busy || !cwd,
    onAdd: addAttachments
  });

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const contentHeight = textarea.scrollHeight;
    setCanExpandComposer(
      contentHeight > 116 || images.length > 0 || files.length > 0
    );
    if (composerExpanded) {
      textarea.style.height = "100%";
      textarea.style.overflowY = "auto";
      return;
    }
    const maximum = mobileViewport ? 118 : 160;
    textarea.style.height = `${Math.min(Math.max(contentHeight, 26), maximum)}px`;
    textarea.style.overflowY = contentHeight > maximum ? "auto" : "hidden";
  }, [composerExpanded, files.length, images.length, mobileViewport, prompt]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<DirectoryItem[]>("/api/directories", { signal: controller.signal }),
      api<HomeSettings>("/api/settings", { signal: controller.signal })
    ])
      .then(([knownDirectories, currentSettings]) => {
        setSettings(currentSettings);
        const requestedDirectory = knownDirectories.find((item) =>
          sameDirectory(item.path, requestedCwd)
        )?.path;
        const preferred =
          requestedDirectory ??
          knownDirectories.find((item) => item.favorite)?.path ??
          knownDirectories[0]?.path ??
          currentSettings.allowedRoots[0] ??
          "";
        setCwd(preferred);
        setPrompt(readDraft(homeDraftScope(preferred)));
        setModel(currentSettings.defaultModel ?? "");
        setThinkingLevel(currentSettings.defaultThinkingLevel ?? "");
        setSystemPrompt(currentSettings.defaultSystemPrompt ?? "");
      })
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, [requestedCwd]);

  const displayedError = error ?? sessionListError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = prompt.trim();
    if (
      (!message && images.length === 0 && files.length === 0) ||
      !cwd ||
      busy ||
      attachmentBusy
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadAttachments(cwd, files);
      const promptWithFiles = appendAttachmentReferences(message, uploaded);
      const payload = {
        cwd,
        displayName: sessionTitleFromPrompt(
          message || files[0]?.name || images[0]?.name || t("附件任务")
        ),
        prompt: promptWithFiles,
        images: images.map(({ type, mimeType, data }) => ({
          type,
          mimeType,
          data
        })),
        model: model || null,
        thinkingLevel: thinkingLevel || null,
        systemPrompt: systemPrompt.trim() || null
      };
      const mutationId = createMutation.current.reserve({
        operation: "sessions.create",
        payload
      });
      const session = await api<SessionRecord>("/api/sessions", {
        method: "POST",
        ...jsonBody({
          ...payload,
          mutationId
        })
      });
      createMutation.current.confirm(mutationId);
      clearDraft(homeDraftScope(cwd));
      await clearImages();
      setFiles([]);
      navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  }

  if (error && !settings) {
    return <ErrorBanner error={displayedError} />;
  }
  if (!settings) return <Loading label={t("准备工作区")} />;

  return (
    <div className={ui(`home-workbench${railOpen ? "" : " rail-collapsed"}`)}>
      {railOpen && (
        <>
          <SessionNavigator
            sessions={sessions ?? []}
            cwd={cwd}
            onClose={() => setRailOpen(false)}
            onSessionRenamed={(updated) =>
              setSessions((current) =>
                current?.map((session) =>
                  session.id === updated.id ? updated : session
                ) ?? null
              )
            }
            onSessionPinned={(updated) =>
              setSessions((current) =>
                current?.map((session) =>
                  session.id === updated.id ? updated : session
                ) ?? null
              )
            }
            onSessionDeleted={(sessionId) =>
              setSessions(
                (current) =>
                  current?.filter((session) => session.id !== sessionId) ?? null
              )
            }
          />
          <button
            className={ui("workbench-rail-backdrop")}
            aria-label={t("收起会话栏")}
            onClick={() => setRailOpen(false)}
          />
        </>
      )}

      <main className={ui("home-start")}>
        <header className={ui("workbench-topbar")}>
          <IconButton
            className={ui("workbench-rail-toggle")}
            label={railOpen ? t("收起会话栏") : t("展开会话栏")}
            variant="toolbar"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((value) => !value)}
          >
            <span className={ui("desktop-rail-toggle-icon")}>
              {railOpen ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </span>
            <Menu
              className={ui("mobile-rail-toggle-icon")}
              size={22}
              aria-hidden="true"
            />
          </IconButton>
          <div className={ui("workbench-topbar-title")}>
            <strong>{t("新会话")}</strong>
            <span>{cwd ? folderName(cwd) : t("选择工作目录")}</span>
          </div>
          <div className={ui("workbench-topbar-actions")}>
            <IconButton
              className={ui("mobile-home-search")}
              label={t("搜索")}
              variant="toolbar"
              onClick={() =>
                window.dispatchEvent(new Event("pi-web:open-command"))
              }
            >
              <Search size={20} />
            </IconButton>
          </div>
        </header>

        <div className={ui("home-start-content")}>
          <div className={ui("home-start-inner")}>
            <div className={ui("home-intro")}>
              <div className={ui("home-agent-mark")} aria-hidden="true">
                <img src="/pi-web.svg" alt="" />
              </div>
              <h1>{t("今天要做什么？")}</h1>
            </div>

            {displayedError !== null && (
              <ErrorBanner
                error={displayedError}
                {...(error !== null
                  ? { onDismiss: () => setError(null) }
                  : {})}
              />
            )}

            <div className={ui("mobile-home-actions")}>
              <AttachmentPicker
                className={ui("mobile-home-action")}
                visibleLabel
                disabled={busy || attachmentBusy}
                onAdd={addAttachments}
              />
              <Button
                type="button"
                variant="ghost"
                className={ui("mobile-home-action")}
                onClick={() => setRuntimeOpen(true)}
              >
                <FolderOpen size={22} />
                <span>{t("选择项目")}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={ui("mobile-home-action")}
                onClick={() => setRuntimeOpen(true)}
              >
                <SlidersHorizontal size={22} />
                <span>{t("配置模型")}</span>
              </Button>
            </div>

            <form
              className={ui(
                `home-composer${composerExpanded ? " composer-expanded" : ""}${dragActive ? " attachment-drag-active" : ""}`
              )}
              aria-busy={busy || attachmentBusy}
              onSubmit={submit}
              {...dropZoneProps}
            >
              {dragActive && (
                <div className={ui("attachment-drop-overlay")} role="status">
                  {t("拖放图片或文件到这里")}
                </div>
              )}
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  setPrompt(value);
                  writeDraft(homeDraftScope(cwd), value);
                }}
                rows={2}
                placeholder={
                  mobileViewport
                    ? t("问问 Pi Web")
                    : t("描述任务，使用 @ 引用工作区文件，或添加附件…")
                }
                aria-label={t("新会话任务")}
                autoFocus={!mobileViewport}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.items)
                    .filter((item) => item.type.startsWith("image/"))
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);
                  if (files.length === 0) return;
                  event.preventDefault();
                  void addAttachments(files);
                }}
                onKeyDown={(event) => {
                  if (
                    shouldSubmitComposerInput({
                      key: event.key,
                      shiftKey: event.shiftKey,
                      isComposing: event.nativeEvent.isComposing,
                      keyCode: event.keyCode
                    })
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <ImageAttachmentTray
                images={images}
                disabled={busy}
                onChange={setImages}
              />
              <FileAttachmentTray
                files={files}
                disabled={busy}
                onChange={setFiles}
              />
              {canExpandComposer && (
                <IconButton
                  className={ui("composer-expand-toggle")}
                  label={composerExpanded ? t("收起输入框") : t("展开输入框")}
                  variant="toolbar"
                  size="sm"
                  onClick={() => setComposerExpanded((value) => !value)}
                >
                  {composerExpanded ? (
                    <Minimize2 size={16} />
                  ) : (
                    <Maximize2 size={16} />
                  )}
                </IconButton>
              )}
              <div className={ui("home-composer-bar")}>
                <div className={ui("home-composer-tools")}>
                  <AttachmentPicker
                    disabled={busy || attachmentBusy}
                    onAdd={addAttachments}
                  />
                  <Button
                    type="button"
                    variant="toolbar"
                    size="sm"
                    className={ui("codex-runtime-trigger")}
                    active={runtimeOpen}
                    aria-haspopup="dialog"
                    aria-expanded={runtimeOpen}
                    aria-label={t("设置工作目录、模型、思考级别和附加提示词")}
                    title={t("会话运行设置")}
                    onClick={() => setRuntimeOpen(true)}
                  >
                    <SlidersHorizontal size={17} />
                    <span>{shortModelName(model) || t("默认模型")}</span>
                    <small>{thinkingLevel || t("默认思考")}</small>
                    <ChevronDown size={13} />
                  </Button>
                  {systemPrompt.trim() ? (
                    <span className={ui("codex-prompt-indicator")}>
                      {t("已附加提示词")}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  size="icon"
                  loading={busy}
                  loadingLabel={t("创建中…")}
                  disabled={
                    (!prompt.trim() && images.length === 0 && files.length === 0) ||
                    !cwd ||
                    attachmentBusy
                  }
                  aria-label={t("创建会话并发送")}
                  tooltip={t("创建会话并发送")}
                >
                  <Send size={17} />
                </Button>
              </div>
            </form>

            <Dialog
              open={runtimeOpen}
              labelledBy="new-session-runtime-title"
              className={ui("runtime-config-dialog new-session-runtime-dialog")}
              maxWidth={680}
              onClose={() => setRuntimeOpen(false)}
            >
              <header className={ui("dialog-heading runtime-config-heading")}>
                <div>
                  <p className={ui("eyebrow")}>NEW SESSION</p>
                  <h2 id="new-session-runtime-title">{t("会话运行设置")}</h2>
                  <span>{t("这些选项只影响即将创建的会话。")}</span>
                </div>
                <IconButton
                  label={t("关闭会话运行设置")}
                  onClick={() => setRuntimeOpen(false)}
                >
                  <X size={18} />
                </IconButton>
              </header>

              <div className={ui("runtime-config-grid")}>
                <div className={ui("field runtime-directory-field")}>
                  <span>{t("工作目录")}</span>
                  <DirectoryPicker
                    roots={settings.allowedRoots}
                    value={cwd}
                    disabled={busy}
                    onChange={(nextCwd) => {
                      writeDraft(homeDraftScope(cwd), prompt);
                      setCwd(nextCwd);
                      setPrompt(readDraft(homeDraftScope(nextCwd)));
                      setFiles([]);
                    }}
                  />
                </div>
                <div className={ui("field")}>
                  <span>{t("模型")}</span>
                  <ModelSelect
                    value={model}
                    disabled={busy}
                    onChange={setModel}
                    onError={setError}
                  />
                </div>
                <div className={ui("field")}>
                  <span>{t("思考级别")}</span>
                  <ThinkingLevelControl
                    value={thinkingLevel}
                    disabled={busy}
                    allowDefault
                    onChange={setThinkingLevel}
                  />
                </div>
                <label className={ui("field runtime-prompt-field")}>
                  <span>{t("附加系统提示词")}</span>
                  <textarea
                    rows={3}
                    value={systemPrompt}
                    disabled={busy}
                    aria-label={t("附加系统提示词")}
                    placeholder={t(
                      "可选：追加到 Pi 自带系统提示词，不会替换编码代理能力"
                    )}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                  />
                  <small>
                    {t("初始值来自全局设置；清空表示这个会话不追加。")}
                  </small>
                </label>
              </div>

              <footer className={ui("dialog-actions runtime-config-actions")}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setModel(settings.defaultModel ?? "");
                    setThinkingLevel(settings.defaultThinkingLevel ?? "");
                    setSystemPrompt(settings.defaultSystemPrompt ?? "");
                  }}
                >
                  {t("恢复全局默认")}
                </Button>
                <Button type="button" onClick={() => setRuntimeOpen(false)}>
                  {t("完成")}
                </Button>
              </footer>
            </Dialog>
          </div>
        </div>
      </main>

    </div>
  );
}

export function sessionTitleFromPrompt(prompt: string): string {
  const line = prompt.split(/\r?\n/, 1)[0]?.trim() || t("Pi 会话");
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

function sameDirectory(left: string, right: string): boolean {
  if (!right) return false;
  const normalize = (value: string) => {
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized)
      ? normalized.toLocaleLowerCase()
      : normalized;
  };
  return normalize(left) === normalize(right);
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function shortModelName(model: string): string {
  return model.split("/").at(-1) ?? model;
}

function homeDraftScope(cwd: string): string {
  return `new:${cwd || "unassigned"}`;
}
