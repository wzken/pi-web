import {
  Braces,
  FolderOpen,
  Gauge,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings2,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { SessionRecord, ThinkingLevel } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import { Button, ButtonLink, ErrorBanner, IconButton, Loading } from "../components";
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
import { ModelSelect } from "../ModelSelect";
import { useNavigate } from "../router";
import { SessionNavigator, useWorkbenchRail } from "../SessionNavigator";
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
  "浏览代码库并说明它的核心结构",
  "检查最近的改动，找出可能的回归",
  "运行测试并修复第一个失败项",
  "帮我规划下一步实现"
];

export function HomePage() {
  const navigate = useNavigate();
  const [railOpen, setRailOpen] = useWorkbenchRail();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [settings, setSettings] = useState<HomeSettings | null>(null);
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | "">("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [files, setFiles] = useState<PendingFileAttachment[]>([]);
  const {
    images,
    setImages,
    clear: clearImages
  } = useImageAttachmentDraft(homeDraftScope(cwd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<SessionRecord[]>("/api/sessions", { signal: controller.signal }),
      api<DirectoryItem[]>("/api/directories", { signal: controller.signal }),
      api<HomeSettings>("/api/settings", { signal: controller.signal })
    ])
      .then(([items, knownDirectories, currentSettings]) => {
        setSessions(items);
        setSettings(currentSettings);
        const preferred =
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
  }, []);

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
      const session = await api<SessionRecord>("/api/sessions", {
        method: "POST",
        ...jsonBody({
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
        })
      });
      clearDraft(homeDraftScope(cwd));
      await clearImages();
      setFiles([]);
      navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason);
      setBusy(false);
    }
  }

  if (error && (!sessions || !settings)) return <ErrorBanner error={error} />;
  if (!sessions || !settings) return <Loading label={t("准备工作区")} />;

  return (
    <div className={ui(`home-workbench${railOpen ? "" : " rail-collapsed"}`)}>
      {railOpen && (
        <>
          <SessionNavigator
            sessions={sessions}
            cwd={cwd}
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
            label={railOpen ? t("收起会话栏") : t("展开会话栏")}
            variant="toolbar"
            onClick={() => setRailOpen((value) => !value)}
          >
            {railOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </IconButton>
          <div className={ui("workbench-topbar-title")}>
            <strong>{t("新会话")}</strong>
            <span>{cwd ? folderName(cwd) : t("选择工作目录")}</span>
          </div>
          <div className={ui("workbench-topbar-actions")}>
            <ButtonLink to="/sessions" variant="toolbar" size="sm">
              {t("全部会话")}
            </ButtonLink>
            <ButtonLink to="/settings" variant="toolbar" size="sm">
              {t("设置")}
            </ButtonLink>
          </div>
        </header>

        <div className={ui("home-start-content")}>
          <div className={ui("home-start-inner")}>
            <div className={ui("home-kicker")}>
              <span className={ui("status-led")} />
              PI READY
            </div>
            <h1>{t("要在 {{workspace}} 中做什么？", {
              workspace: cwd ? folderName(cwd) : t("工作区")
            })}</h1>
            <p>{t("输入任务即创建会话；目录、模型和系统提示词会随会话保存。")}</p>

            {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

            <form className={ui("home-composer")} onSubmit={submit}>
              <textarea
                value={prompt}
                onChange={(event) => {
                  const value = event.target.value;
                  setPrompt(value);
                  writeDraft(homeDraftScope(cwd), value);
                }}
                rows={4}
                placeholder={t("描述任务，使用 @ 引用工作区文件，或添加附件…")}
                aria-label={t("新会话任务")}
                autoFocus
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
                  if (event.key === "Enter" && !event.shiftKey) {
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
                <AttachmentPicker
                  images={images}
                  files={files}
                  disabled={busy}
                  onImagesChange={setImages}
                  onFilesChange={setFiles}
                  onError={setError}
                />
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
                <div className={ui("home-composer-runtime")}>
                  <ModelSelect
                    className={ui("composer-inline-select")}
                    value={model}
                    disabled={busy}
                    onChange={setModel}
                  />
                  <label className={ui("composer-thinking-select")}>
                    <Gauge size={14} />
                    <select
                      value={thinkingLevel}
                      disabled={busy}
                      aria-label={t("思考级别")}
                      onChange={(event) =>
                        setThinkingLevel(event.target.value as ThinkingLevel | "")
                      }
                    >
                      <option value="">{t("默认")}</option>
                      {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                  </label>
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
              <details className={ui("home-runtime-settings")}>
                <summary><Settings2 size={13} />{t("系统提示词")}</summary>
                <div>
                  <label className={ui("home-system-prompt-field")}>
                    <span>{t("附加系统提示词")}</span>
                    <textarea
                      rows={4}
                      value={systemPrompt}
                      onChange={(event) => setSystemPrompt(event.target.value)}
                      placeholder={t("可选：追加到 Pi 自带系统提示词，不会替换编码代理能力")}
                    />
                    <small>{t("仅对这个新会话生效；清空表示不追加。")}</small>
                  </label>
                </div>
              </details>
            </form>

            <div className={ui("home-suggestions")} aria-label={t("任务建议")}>
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="toolbar"
                  onClick={() => {
                    const translated = t(suggestion);
                    setPrompt(translated);
                    writeDraft(homeDraftScope(cwd), translated);
                  }}
                >
                  {t(suggestion)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </main>

      <aside className={ui("home-context-panel")}>
        <header>
          <span><FolderOpen size={14} /> {t("工作区")}</span>
          <ButtonLink to="/settings" variant="ghost" size="sm">
            {t("设置")}
          </ButtonLink>
        </header>
        <div className={ui("home-context-summary")}>
          <div className={ui("context-icon")}><FolderOpen size={20} /></div>
          <strong>{cwd ? folderName(cwd) : t("尚未选择目录")}</strong>
          <p title={cwd}>
            {cwd ? compactPath(cwd) : t("请从输入框下方选择允许的工作目录。")}
          </p>
        </div>
        <dl className={ui("home-context-facts")}>
          <div>
            <dt><SlidersHorizontal size={13} /> {t("模型")}</dt>
            <dd>{model || t("Pi 默认")}</dd>
          </div>
          <div>
            <dt><Gauge size={13} /> {t("思考")}</dt>
            <dd>{thinkingLevel || t("默认")}</dd>
          </div>
          <div>
            <dt><Braces size={13} /> {t("系统提示词")}</dt>
            <dd>{systemPrompt.trim() ? t("已追加") : t("使用全局设置")}</dd>
          </div>
        </dl>
        <div className={ui("home-context-note")}>
          <strong>{t("附件会保存到哪里？")}</strong>
          <p>{t("普通文件上传到当前目录的 `.pi-web/attachments`，并作为相对路径交给 Pi；图片保持内联发送。")}</p>
        </div>
      </aside>
    </div>
  );
}

export function sessionTitleFromPrompt(prompt: string): string {
  const line = prompt.split(/\r?\n/, 1)[0]?.trim() || t("Pi 会话");
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function compactPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}

function homeDraftScope(cwd: string): string {
  return `new:${cwd || "unassigned"}`;
}
