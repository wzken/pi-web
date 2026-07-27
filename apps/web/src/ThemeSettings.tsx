import {
  Image,
  Link2,
  Monitor,
  Moon,
  PackageOpen,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type {
  InstalledTheme,
  ThemeCatalog,
  ThemePreferences
} from "@pi-web/protocol";
import { Button, ErrorBanner, LoadingSpinner, useToast } from "./components";
import {
  themeSchemeLabel,
  themeSupportsColorScheme,
  themeTokensForScheme,
  useTheme
} from "./theme";
import { t } from "./i18n";
import { ui } from "./ui";

export function ThemeSettings() {
  const {
    catalog,
    loading,
    safeMode,
    resolvedColorScheme,
    previewPreferences,
    updatePreferences,
    installTheme,
    removeTheme,
    uploadBackground,
    removeBackground
  } = useTheme();
  const [draft, setDraft] = useState<ThemePreferences | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [deletingTheme, setDeletingTheme] = useState(false);
  const themeInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (catalog && draft === null) setDraft(catalog.preferences);
  }, [catalog, draft]);

  useEffect(() => {
    if (!draft || safeMode) return;
    previewPreferences(draft);
    return () => previewPreferences(null);
  }, [draft, previewPreferences, safeMode]);

  const selectedTheme = useMemo(
    () => catalog?.themes.find((theme) => theme.id === draft?.themeId) ?? null,
    [catalog, draft?.themeId]
  );
  const previewUrl = backgroundPreviewUrl(catalog, selectedTheme, draft);

  function selectColorMode(colorMode: ThemePreferences["colorMode"]) {
    if (!draft) return;
    const targetScheme =
      colorMode === "system" ? resolvedColorScheme : colorMode;
    const matchingTheme =
      selectedTheme &&
      themeSupportsColorScheme(selectedTheme, targetScheme)
        ? selectedTheme
        : catalog?.themes.find((theme) => theme.id === `agegr-${targetScheme}`);
    setDraft({
      ...draft,
      colorMode,
      themeId: matchingTheme?.id ?? draft.themeId
    });
  }

  async function saveAppearance() {
    if (!draft || saving || safeMode) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updatePreferences(draft);
      setDraft(next.preferences);
      toast.push(t("外观已应用"));
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  }

  async function handleThemeArchive(file: File | undefined) {
    if (!file || installing) return;
    setInstalling(true);
    setError(null);
    try {
      const knownIds = new Set(catalog?.themes.map((theme) => theme.id) ?? []);
      const next = await installTheme(file);
      const installed =
        next.themes.find(
          (theme) => theme.source === "uploaded" && !knownIds.has(theme.id)
        ) ??
        next.themes.find(
          (theme) =>
            theme.source === "uploaded" &&
            theme.name.toLowerCase() === file.name.replace(/\.zip$/i, "").toLowerCase()
        );
      if (installed && draft) setDraft({ ...draft, themeId: installed.id });
      toast.push(
        installed
          ? t("已安装 {{name}}", { name: installed.name })
          : t("主题包已更新")
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setInstalling(false);
      if (themeInput.current) themeInput.current.value = "";
    }
  }

  async function handleBackground(file: File | undefined) {
    if (!file || uploadingBackground || !draft) return;
    setUploadingBackground(true);
    setError(null);
    try {
      await uploadBackground(file);
      setDraft({
        ...draft,
        background: { ...draft.background, kind: "upload", url: "" }
      });
      toast.push(t("背景图片已上传，点击“应用外观”生效"));
    } catch (reason) {
      setError(reason);
    } finally {
      setUploadingBackground(false);
      if (backgroundInput.current) backgroundInput.current.value = "";
    }
  }

  async function deleteSelectedTheme() {
    if (
      !selectedTheme ||
      selectedTheme.source !== "uploaded" ||
      deletingTheme ||
      !confirm(t("删除主题包“{{name}}”？主题文件将从服务器移除。", {
        name: selectedTheme.name
      }))
    ) {
      return;
    }
    setDeletingTheme(true);
    setError(null);
    try {
      const next = await removeTheme(selectedTheme.id);
      setDraft(next.preferences);
      toast.push(t("主题包已删除"));
    } catch (reason) {
      setError(reason);
    } finally {
      setDeletingTheme(false);
    }
  }

  async function clearUploadedBackground() {
    if (!draft || uploadingBackground) return;
    setUploadingBackground(true);
    setError(null);
    try {
      const next = await removeBackground();
      setDraft(next.preferences);
      toast.push(t("已移除上传的背景"));
    } catch (reason) {
      setError(reason);
    } finally {
      setUploadingBackground(false);
    }
  }

  if (loading && !catalog) {
    return (
      <article className={ui("panel settings-section theme-settings")}>
        <div className={ui("settings-icon")}><Palette size={19} /></div>
        <div className={ui("settings-content theme-loading")}>
          <LoadingSpinner size={17} />
          <span>{t("读取主题")}</span>
        </div>
      </article>
    );
  }
  if (!catalog || !draft) return null;

  return (
    <article className={ui("panel settings-section theme-settings")}>
      <div className={ui("settings-icon")}><Palette size={19} /></div>
      <div className={ui("settings-content")}>
        <div className={ui("settings-heading theme-heading")}>
          <div>
            <h2>{t("外观与主题包")}</h2>
            <p>{t("主题可覆盖设计 token、组件 CSS、字体和背景；内置 Agegr Light / Dark。")}</p>
          </div>
          <span className={ui("theme-security-note")}>
            <ShieldCheck size={14} />
            {t("声明式包，不执行脚本")}
          </span>
        </div>

        {safeMode && (
          <div className={ui("theme-safe-banner")}>
            <ShieldCheck size={17} />
            <div>
              <strong>{t("安全主题模式已开启")}</strong>
              <span>{t("当前强制使用内置主题，并忽略主题 CSS 与背景。")}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                window.location.href = window.location.pathname;
              }}
            >
              {t("退出安全模式")}
            </Button>
          </div>
        )}

        {error !== null && (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        )}

        <div className={ui("theme-subsection")}>
          <div className={ui("theme-subheading")}>
            <div>
              <h3>{t("配色模式")}</h3>
              <p>
                {t("双模式主题会在同一主题内切换；单模式主题不匹配时使用对应的内置 Agegr 配色。")}
              </p>
            </div>
          </div>
          <div className={ui("theme-mode-picker")} role="radiogroup" aria-label={t("配色模式")}>
            <ColorModeChoice
              label={t("自动")}
              description={t("当前{{scheme}}", {
                scheme: resolvedColorScheme === "dark" ? t("深色") : t("浅色")
              })}
              value="system"
              checked={draft.colorMode === "system"}
              icon={<Monitor size={16} />}
              onSelect={() => selectColorMode("system")}
            />
            <ColorModeChoice
              label={t("浅色")}
              description={t("始终浅色")}
              value="light"
              checked={draft.colorMode === "light"}
              icon={<Sun size={16} />}
              onSelect={() => selectColorMode("light")}
            />
            <ColorModeChoice
              label={t("深色")}
              description={t("始终深色")}
              value="dark"
              checked={draft.colorMode === "dark"}
              icon={<Moon size={16} />}
              onSelect={() => selectColorMode("dark")}
            />
          </div>
        </div>

        <div className={ui("theme-subsection")}>
          <div className={ui("theme-subheading")}>
            <div>
              <h3>{t("主题")}</h3>
              <p>{t("内置主题不可删除；上传同 ID 的 ZIP 可更新已安装主题。")}</p>
            </div>
            <div className={ui("theme-actions")}>
              <input
                ref={themeInput}
                className={ui("visually-hidden")}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                onChange={(event) =>
                  void handleThemeArchive(event.target.files?.[0])
                }
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={installing}
                loadingLabel={t("安装中…")}
                onClick={() => themeInput.current?.click()}
              >
                <Upload size={15} />
                {t("上传 ZIP 主题包")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={selectedTheme?.source !== "uploaded"}
                loading={deletingTheme}
                loadingLabel={t("删除中…")}
                onClick={() => void deleteSelectedTheme()}
              >
                <Trash2 size={15} />
                {t("删除")}
              </Button>
            </div>
          </div>

          <div className={ui("theme-picker")} role="radiogroup" aria-label={t("选择主题")}>
            {catalog.themes.map((theme) => (
              <ThemeChoice
                key={theme.id}
                theme={theme}
                checked={draft.themeId === theme.id}
                colorScheme={resolvedColorScheme}
                onSelect={() =>
                  setDraft({
                    ...draft,
                    themeId: theme.id,
                    colorMode: themeSupportsColorScheme(
                      theme,
                      resolvedColorScheme
                    )
                      ? draft.colorMode
                      : theme.schemaVersion === 1
                        ? theme.colorScheme
                        : draft.colorMode
                  })
                }
              />
            ))}
          </div>
        </div>

        <div className={ui("theme-subsection")}>
          <div className={ui("theme-subheading")}>
            <div>
              <h3>{t("工作区背景")}</h3>
              <p>{t("背景位于界面底层；主题仍负责面板透明度和文字对比度。")}</p>
            </div>
          </div>

          <div className={ui("background-editor")}>
            <div className={ui("background-controls")}>
              <label className={ui("field")}>
                <span>{t("背景来源")}</span>
                <select
                  value={draft.background.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      background: {
                        ...draft.background,
                        kind: event.target.value as ThemePreferences["background"]["kind"]
                      }
                    })
                  }
                >
                  <option value="none">{t("无背景图片")}</option>
                  <option
                    value="theme"
                    disabled={!selectedTheme?.backgroundUrl}
                  >
                    {t("主题包自带背景")}
                  </option>
                  <option value="upload">{t("上传到本机")}</option>
                  <option value="url">{t("图片 URL")}</option>
                </select>
              </label>

              {draft.background.kind === "url" && (
                <label className={ui("field")}>
                  <span><Link2 size={14} /> {t("图片 URL")}</span>
                  <input
                    type="url"
                    value={draft.background.url}
                    placeholder="https://example.com/background.webp"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        background: {
                          ...draft.background,
                          url: event.target.value
                        }
                      })
                    }
                  />
                </label>
              )}

              {draft.background.kind === "upload" && (
                <div className={ui("background-upload-row")}>
                  <input
                    ref={backgroundInput}
                    className={ui("visually-hidden")}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    onChange={(event) =>
                      void handleBackground(event.target.files?.[0])
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={uploadingBackground}
                    loadingLabel={t("上传中…")}
                    onClick={() => backgroundInput.current?.click()}
                  >
                    <Image size={15} />
                    {catalog.userBackgroundUrl ? t("更换图片") : t("上传图片")}
                  </Button>
                  {catalog.userBackgroundUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void clearUploadedBackground()}
                    >
                      <Trash2 size={15} />
                      {t("移除图片")}
                    </Button>
                  )}
                  <span>{t("PNG / JPEG / WebP / GIF / AVIF，最大 8 MB")}</span>
                </div>
              )}

              {draft.background.kind !== "none" && (
                <div className={ui("background-options")}>
                  <label className={ui("field")}>
                    <span>{t("填充方式")}</span>
                    <select
                      value={draft.background.fit}
                      disabled={draft.background.kind === "theme"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          background: {
                            ...draft.background,
                            fit: event.target.value as ThemePreferences["background"]["fit"]
                          }
                        })
                      }
                    >
                      <option value="cover">{t("覆盖")}</option>
                      <option value="contain">{t("完整显示")}</option>
                      <option value="tile">{t("平铺")}</option>
                    </select>
                  </label>
                  <label className={ui("field")}>
                    <span>{t("位置")}</span>
                    <select
                      value={draft.background.position}
                      disabled={draft.background.kind === "theme"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          background: {
                            ...draft.background,
                            position: event.target.value
                          }
                        })
                      }
                    >
                      <option value="center">{t("居中")}</option>
                      <option value="top">{t("顶部")}</option>
                      <option value="bottom">{t("底部")}</option>
                      <option value="left">{t("左侧")}</option>
                      <option value="right">{t("右侧")}</option>
                    </select>
                  </label>
                  <label className={ui("field range-field")}>
                    <span>{t("遮罩 {{value}}%", {
                      value: Math.round(draft.background.overlay * 100)
                    })}</span>
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.02"
                      value={draft.background.overlay}
                      disabled={draft.background.kind === "theme"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          background: {
                            ...draft.background,
                            overlay: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </label>
                  <label className={ui("field range-field")}>
                    <span>{t("模糊 {{value}}px", {
                      value: draft.background.blur
                    })}</span>
                    <input
                      type="range"
                      min="0"
                      max="24"
                      step="1"
                      value={draft.background.blur}
                      disabled={draft.background.kind === "theme"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          background: {
                            ...draft.background,
                            blur: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div
              className={ui(`background-preview${previewUrl ? " has-image" : ""}`)}
              style={backgroundPreviewStyle(previewUrl, draft, selectedTheme)}
              aria-label={t("背景预览")}
            >
              <div className={ui("background-preview-window")}>
                <span />
                <span />
                <span />
                <strong>PI WEB</strong>
              </div>
              <div className={ui("background-preview-content")}>
                <PackageOpen size={20} />
                <span>{previewUrl ? t("背景预览") : t("未设置背景")}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={ui("theme-footer")}>
          <div>
            <strong>{selectedTheme?.name ?? t("未选择主题")}</strong>
            <span>
              {selectedTheme?.source === "uploaded" ? t("上传主题") : t("内置主题")}
              {selectedTheme ? ` · v${selectedTheme.version}` : ""}
              {` · ${
                draft.colorMode === "system"
                  ? t("跟随系统")
                  : draft.colorMode === "dark"
                    ? t("深色")
                    : t("浅色")
              }`}
            </span>
          </div>
          <div className={ui("theme-actions")}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={safeMode}
              onClick={() =>
                setDraft({
                  ...catalog.preferences,
                  themeId: "agegr-light",
                  colorMode: "system",
                  background: {
                    ...catalog.preferences.background,
                    kind: "none",
                    url: ""
                  }
                })
              }
            >
              <RotateCcw size={15} />
              {t("恢复默认")}
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saving}
              loadingLabel={t("应用中…")}
              disabled={safeMode}
              onClick={() => void saveAppearance()}
            >
              <Palette size={15} />
              {t("应用外观")}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ColorModeChoice({
  label,
  description,
  value,
  checked,
  icon,
  onSelect
}: {
  label: string;
  description: string;
  value: ThemePreferences["colorMode"];
  checked: boolean;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <label className={ui(`theme-mode-choice${checked ? " is-selected" : ""}`)}>
      <input
        type="radio"
        name="color-mode"
        value={value}
        checked={checked}
        onChange={onSelect}
      />
      <span className={ui("theme-mode-icon")}>{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function ThemeChoice({
  theme,
  checked,
  colorScheme,
  onSelect
}: {
  theme: InstalledTheme;
  checked: boolean;
  colorScheme: "light" | "dark";
  onSelect: () => void;
}) {
  const controlId = `theme-choice-${theme.id}`;
  const tokens = themeTokensForScheme(
    theme,
    themeSupportsColorScheme(theme, colorScheme)
      ? colorScheme
      : theme.schemaVersion === 1
        ? theme.colorScheme
        : "light"
  );
  return (
    <label
      className={ui(`theme-choice${checked ? " is-selected" : ""}`)}
      htmlFor={controlId}
    >
      <input
        id={controlId}
        type="radio"
        name="theme"
        value={theme.id}
        checked={checked}
        onChange={onSelect}
      />
      <span
        className={ui("theme-swatch")}
        style={{
          background: tokens["--bg"] ?? "#fff",
          borderColor: tokens["--line"] ?? "#ddd",
          color: tokens["--text"] ?? "#222"
        }}
      >
        <i style={{ background: tokens["--panel"] ?? "#fff" }} />
        <b style={{ background: tokens["--teal"] ?? "#397a6a" }} />
      </span>
      <span className={ui("theme-choice-copy")}>
        <strong>{theme.name}</strong>
        <small>
          {theme.source === "built-in" ? t("内置") : t("已上传")} ·{" "}
          {themeSchemeLabel(theme)}
        </small>
      </span>
    </label>
  );
}

function backgroundPreviewUrl(
  catalog: ThemeCatalog | null,
  theme: InstalledTheme | null,
  draft: ThemePreferences | null
): string | undefined {
  if (!catalog || !draft) return undefined;
  if (draft.background.kind === "theme") return theme?.backgroundUrl;
  if (draft.background.kind === "upload") return catalog.userBackgroundUrl;
  if (draft.background.kind === "url") return draft.background.url || undefined;
  return undefined;
}

function backgroundPreviewStyle(
  url: string | undefined,
  draft: ThemePreferences,
  theme: InstalledTheme | null
) {
  if (!url) return undefined;
  const themeBackground =
    draft.background.kind === "theme" ? theme?.background : undefined;
  const overlay = themeBackground?.overlay ?? draft.background.overlay;
  const fit = themeBackground?.fit ?? draft.background.fit;
  return {
    backgroundImage: `linear-gradient(rgb(10 14 13 / ${overlay}), rgb(10 14 13 / ${overlay})), url(${JSON.stringify(url)})`,
    backgroundSize: fit === "tile" ? "auto" : fit,
    backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: themeBackground?.position ?? draft.background.position
  };
}
