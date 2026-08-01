import {
  ArrowUpRight,
  Bug,
  Code2,
  FlaskConical,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionRecord, ThinkingLevel } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  ButtonLink,
  Dialog,
  ErrorBanner,
  IconButton,
  Loading
} from "../components";
import { shouldSubmitComposerInput } from "../composer-input";
import { DirectoryPicker } from "../DirectoryPicker";
import { clearDraft, readDraft, writeDraft } from "../draft-store";
import {
  appendImageFiles,
  ImageAttachmentTray,
  useImageAttachmentDraft
} from "../ImageAttachments";
import {
  appendAttachmentReferences,
  AttachmentPicker,
  FileAttachmentTray,
  uploadAttachments,
  type PendingFileAttachment
} from "../FileAttachments";
import { PendingMutationTracker } from "../mutation-id";
import { ModelSelect } from "../ModelSelect";
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

const suggestions = [
  {
    label: "浏览代码库并说明它的核心结构",
    icon: Code2
  },
  {
    label: "检查最近的改动，找出可能的回归",
    icon: Bug
  },
  {
    label: "运行测试并修复第一个失败项",
    icon: FlaskConical
  }
];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const createMutation = useRef(new PendingMutationTracker());

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
    if ((!message && images.length === 0 && files.length === 0) || !cwd || busy) {
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
            {railOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </IconButton>
          <div className={ui("workbench-topbar-title")}>
            <strong>{t("新会话")}</strong>
            <span>{cwd ? folderName(cwd) : t("选择工作目录")}</span>
          </div>
          <div className={ui("workbench-topbar-actions")}>
            <ButtonLink
              to="/sessions"
              variant="toolbar"
              size="sm"
              tooltip={t("全部会话")}
              aria-label={t("全部会话")}
            >
              <History size={15} />
              <span>{t("全部会话")}</span>
            </ButtonLink>
            <ButtonLink
              to="/settings"
              variant="toolbar"
              size="sm"
              aria-label={t("设置")}
              title={t("设置")}
            >
              <Settings size={15} />
              <span>{t("设置")}</span>
            </ButtonLink>
          </div>
        </header>

        <div className={ui("home-start-content")}>
          <div className={ui("home-start-inner")}>
            <div className={ui("home-intro")}>
              <div className={ui("home-kicker")}>
                <span className={ui("status-led")} />
                PI
              </div>
              <h1>{t("今天要做什么？")}</h1>
              <p>
                {cwd
                  ? t("当前工作区：{{workspace}}", {
                      workspace: folderName(cwd)
                    })
                  : t("选择一个工作目录开始")}
              </p>
            </div>

            {displayedError !== null && (
              <ErrorBanner
                error={displayedError}
                {...(error !== null
                  ? { onDismiss: () => setError(null) }
                  : {})}
              />
            )}

            <div className={ui("home-suggestions")} aria-label={t("任务建议")}>
              {suggestions.map(({ label, icon: SuggestionIcon }) => (
                <Button
                  key={label}
                  variant="toolbar"
                  disabled={busy}
                  onClick={() => {
                    const translated = t(label);
                    const next = prompt.trim()
                      ? `${prompt.trimEnd()}\n${translated}`
                      : translated;
                    setPrompt(next);
                    writeDraft(homeDraftScope(cwd), next);
                  }}
                >
                  <SuggestionIcon size={19} />
                  <span>{t(label)}</span>
                  <ArrowUpRight size={15} />
                </Button>
              ))}
            </div>

            <form className={ui("home-composer")} onSubmit={submit}>
              <textarea
                value={prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  setPrompt(value);
                  writeDraft(homeDraftScope(cwd), value);
                }}
                rows={2}
                placeholder={t("描述任务，使用 @ 引用工作区文件，或添加附件…")}
                aria-label={t("新会话任务")}
                autoFocus={!mobileViewport}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.items)
                    .filter((item) => item.type.startsWith("image/"))
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);
                  if (files.length === 0) return;
                  event.preventDefault();
                  void appendImageFiles(images, files)
                    .then(setImages)
                    .catch(setError);
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
              <div className={ui("home-composer-bar")}>
                <div className={ui("home-composer-tools")}>
                  <AttachmentPicker
                    images={images}
                    files={files}
                    disabled={busy}
                    onImagesChange={setImages}
                    onFilesChange={setFiles}
                    onError={setError}
                  />
                  <Button
                    type="button"
                    variant="toolbar"
                    size="icon"
                    active={runtimeOpen}
                    aria-haspopup="dialog"
                    aria-expanded={runtimeOpen}
                    aria-label={t("设置工作目录、模型、思考级别和附加提示词")}
                    title={t("会话运行设置")}
                    onClick={() => setRuntimeOpen(true)}
                  >
                    <SlidersHorizontal size={17} />
                  </Button>
                  <span className={ui("home-runtime-summary")}>
                    {shortModelName(model) || t("默认模型")}
                    <i aria-hidden="true">·</i>
                    {thinkingLevel || t("默认思考")}
                    {systemPrompt.trim() ? <b>{t("已附加提示词")}</b> : null}
                  </span>
                </div>
                <Button
                  type="submit"
                  size="icon"
                  loading={busy}
                  loadingLabel={t("创建中…")}
                  disabled={
                    (!prompt.trim() && images.length === 0 && files.length === 0) ||
                    !cwd
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
              className={ui("runtime-config-dialog")}
              maxWidth={560}
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
                <label className={ui("field")}>
                  <span>{t("模型")}</span>
                  <ModelSelect
                    value={model}
                    disabled={busy}
                    onChange={setModel}
                    onError={setError}
                  />
                </label>
                <label className={ui("field")}>
                  <span>{t("思考级别")}</span>
                  <select
                    value={thinkingLevel}
                    disabled={busy}
                    aria-label={t("思考级别")}
                    onChange={(event) =>
                      setThinkingLevel(event.target.value as ThinkingLevel | "")
                    }
                  >
                    <option value="">{t("使用全局默认")}</option>
                    {[
                      "off",
                      "minimal",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max"
                    ].map((level) => (
                      <option key={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <label className={ui("field runtime-prompt-field")}>
                  <span>{t("附加系统提示词")}</span>
                  <textarea
                    rows={5}
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
