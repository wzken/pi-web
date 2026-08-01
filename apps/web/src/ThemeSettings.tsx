import {
  Check,
  Image as ImageIcon,
  Link2,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import type { ThemePreferences } from "@pi-web/protocol";
import {
  Button,
  ErrorBanner,
  LoadingSpinner,
  Switch,
  useToast
} from "./components";
import {
  defaultMaterialThemeSettings,
  themeColorPresets,
  useTheme,
  type MaterialThemeSettings,
  type ThemeColorRole
} from "./theme";
import { extractThemeSeedColors } from "./theme-customization";
import { t } from "./i18n";
import { ui } from "./ui";
import styles from "./pages/SettingsPage.module.css";

const colorRoles: ReadonlyArray<{
  role: ThemeColorRole;
  label: string;
  description: string;
}> = [
  {
    role: "primary",
    label: "主色",
    description: "品牌、主要操作与焦点"
  },
  {
    role: "secondary",
    label: "次要色",
    description: "辅助操作与选中状态"
  },
  {
    role: "tertiary",
    label: "第三色",
    description: "强调、提示与高亮"
  },
  {
    role: "neutral",
    label: "中性色",
    description: "背景、表面与边框"
  }
];

type BackgroundSettings = ThemePreferences["background"];
type BackgroundBusyState = "upload" | "remove" | "extract" | null;

const maximumBackgroundBytes = 8 * 1024 * 1024;
const acceptedBackgroundTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

export function ThemeSettings() {
  const {
    catalog,
    activeTheme,
    loading,
    safeMode,
    resolvedColorScheme,
    materialThemeSettings,
    previewPreferences,
    updatePreferences,
    previewMaterialThemeSettings,
    uploadBackground,
    removeBackground
  } = useTheme();
  const [draftThemeId, setDraftThemeId] = useState<string | null>(null);
  const [draftMode, setDraftMode] =
    useState<ThemePreferences["colorMode"] | null>(null);
  const [draftMaterial, setDraftMaterial] =
    useState<MaterialThemeSettings | null>(null);
  const [draftBackground, setDraftBackground] =
    useState<BackgroundSettings | null>(null);
  const [localBackgroundFile, setLocalBackgroundFile] = useState<File | null>(
    null
  );
  const [backgroundBusy, setBackgroundBusy] =
    useState<BackgroundBusyState>(null);
  const [backgroundError, setBackgroundError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (catalog) {
      if (draftThemeId === null) {
        setDraftThemeId(catalog.preferences.themeId);
      }
      if (draftMode === null) {
        setDraftMode(catalog.preferences.colorMode);
      }
    }
  }, [catalog, draftMode, draftThemeId]);

  useEffect(() => {
    if (draftMaterial === null) {
      setDraftMaterial(materialThemeSettings);
    }
  }, [draftMaterial, materialThemeSettings]);

  useEffect(() => {
    if (catalog && draftBackground === null) {
      setDraftBackground(catalog.preferences.background);
    }
  }, [catalog, draftBackground]);

  useEffect(() => {
    if (
      !catalog ||
      !draftThemeId ||
      !draftMode ||
      !draftBackground ||
      safeMode
    ) {
      return;
    }
    previewPreferences({
      ...catalog.preferences,
      themeId: draftThemeId,
      colorMode: draftMode,
      background: draftBackground
    });
    return () => previewPreferences(null);
  }, [
    catalog,
    draftBackground,
    draftMode,
    draftThemeId,
    previewPreferences,
    safeMode
  ]);

  useEffect(() => {
    if (!draftMaterial || safeMode) return;
    previewMaterialThemeSettings(draftMaterial);
    return () => previewMaterialThemeSettings(null);
  }, [draftMaterial, previewMaterialThemeSettings, safeMode]);

  async function saveAppearance() {
    if (
      !catalog ||
      !draftThemeId ||
      !draftMode ||
      !draftMaterial ||
      !draftBackground ||
      saving ||
      safeMode
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      assertBackgroundReady(draftBackground, catalog.userBackgroundUrl);
      const next = await updatePreferences({
        ...catalog.preferences,
        themeId: draftThemeId,
        colorMode: draftMode,
        background: draftBackground,
        materialTheme: draftMaterial
      });
      setDraftThemeId(next.preferences.themeId);
      setDraftMode(next.preferences.colorMode);
      setDraftBackground(next.preferences.background);
      setDraftMaterial(next.preferences.materialTheme);
      toast.push(t("外观已应用"));
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  }

  function restoreDefaults() {
    if (safeMode) return;
    setDraftThemeId("pi-neutral");
    setDraftMode("system");
    setDraftMaterial({
      ...defaultMaterialThemeSettings,
      colors: { ...defaultMaterialThemeSettings.colors }
    });
    setDraftBackground(defaultBackgroundSettings());
    setLocalBackgroundFile(null);
    setBackgroundError(null);
  }

  function updateColor(role: ThemeColorRole, color: string) {
    if (!draftMaterial || !/^#[\da-f]{6}$/i.test(color)) return;
    setDraftMaterial({
      ...draftMaterial,
      enabled: true,
      presetId: null,
      colors: {
        ...draftMaterial.colors,
        [role]: color.toUpperCase()
      }
    });
  }

  function updateBackground(value: Partial<BackgroundSettings>) {
    if (!draftBackground || safeMode) return;
    setDraftBackground({ ...draftBackground, ...value });
    setBackgroundError(null);
  }

  async function handleBackgroundUpload(file: File | undefined) {
    if (!file || backgroundBusy || safeMode) return;
    setBackgroundBusy("upload");
    setBackgroundError(null);
    try {
      validateBackgroundFile(file);
      await uploadBackground(file);
      setLocalBackgroundFile(file);
      setDraftBackground({
        ...(draftBackground ?? defaultBackgroundSettings()),
        kind: "upload",
        url: ""
      });
      toast.push(t("背景图片已上传，可继续调整显示方式"));
    } catch (reason) {
      setBackgroundError(reason);
    } finally {
      setBackgroundBusy(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleBackgroundRemoval() {
    if (backgroundBusy || safeMode) return;
    setBackgroundBusy("remove");
    setBackgroundError(null);
    try {
      await removeBackground();
      setLocalBackgroundFile(null);
      setDraftBackground({
        ...(draftBackground ?? defaultBackgroundSettings()),
        kind: "none",
        url: ""
      });
      toast.push(t("背景图片已移除"));
    } catch (reason) {
      setBackgroundError(reason);
    } finally {
      setBackgroundBusy(null);
    }
  }

  async function extractBackgroundColors() {
    if (
      !draftBackground ||
      !draftMaterial ||
      backgroundBusy ||
      safeMode
    ) {
      return;
    }
    setBackgroundBusy("extract");
    setBackgroundError(null);
    try {
      const source = backgroundExtractionSource(
        draftBackground,
        localBackgroundFile,
        catalog?.userBackgroundUrl,
        activeTheme?.backgroundUrl
      );
      const colors = await extractColorsFromImage(source);
      setDraftMaterial({
        ...draftMaterial,
        enabled: true,
        presetId: null,
        colors
      });
      toast.push(t("已从背景提取四色，可继续单独微调"));
    } catch (reason) {
      setBackgroundError(reason);
    } finally {
      setBackgroundBusy(null);
    }
  }

  if (loading && !catalog) {
    return (
      <section className={styles.appearanceCard} aria-labelledby="appearance-title">
        <div className={styles.loadingState}>
          <LoadingSpinner size={18} />
          <span>{t("读取主题")}</span>
        </div>
      </section>
    );
  }

  if (
    !catalog ||
    !draftThemeId ||
    !draftMode ||
    !draftMaterial ||
    !draftBackground
  ) {
    return null;
  }

  const backgroundPreviewUrl = resolveBackgroundPreviewUrl(
    draftBackground,
    catalog.userBackgroundUrl,
    activeTheme?.backgroundUrl
  );
  const supportsThemeBackground = Boolean(activeTheme?.backgroundUrl);

  return (
    <section
      id="appearance"
      className={styles.appearanceCard}
      aria-labelledby="appearance-title"
    >
      <div className={styles.sectionHeading}>
        <span className={styles.sectionIcon} aria-hidden="true">
          <Palette size={20} />
        </span>
        <div>
          <h2 id="appearance-title">{t("外观")}</h2>
          <p>{t("选择显示模式，并用四个关键颜色定义整个工作区。")}</p>
        </div>
      </div>

      {safeMode && (
        <div className={styles.safeModeBanner}>
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>{t("安全主题模式已开启")}</strong>
            <span>{t("当前强制使用内置主题，并忽略主题 CSS 与背景。")}</span>
          </div>
        </div>
      )}

      {error !== null && (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      )}

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("配色模式")}</h3>
          <p>
            {draftMode === "system"
              ? t("当前{{scheme}}", {
                  scheme:
                    resolvedColorScheme === "dark" ? t("深色") : t("浅色")
                })
              : draftMode === "dark"
                ? t("始终深色")
                : t("始终浅色")}
          </p>
        </div>
        <div
          className={styles.segmentedControl}
          role="radiogroup"
          aria-label={t("配色模式")}
        >
          <ModeChoice
            label={t("跟随系统")}
            value="system"
            checked={draftMode === "system"}
            icon={<Monitor size={18} />}
            onSelect={() => setDraftMode("system")}
          />
          <ModeChoice
            label={t("浅色")}
            value="light"
            checked={draftMode === "light"}
            icon={<Sun size={18} />}
            onSelect={() => setDraftMode("light")}
          />
          <ModeChoice
            label={t("深色")}
            value="dark"
            checked={draftMode === "dark"}
            icon={<Moon size={18} />}
            onSelect={() => setDraftMode("dark")}
          />
        </div>
      </div>

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("主题包")}</h3>
          <p>
            {t(
              "主题包继续提供字体、圆角与组件细节；自定义四色仅覆盖颜色。"
            )}
          </p>
        </div>
        <label className={styles.themePackageField}>
          <span>{t("选择已安装主题")}</span>
          <select
            value={draftThemeId}
            disabled={safeMode}
            onChange={(event) => setDraftThemeId(event.currentTarget.value)}
          >
            {catalog.themes.map((theme) => (
              <option value={theme.id} key={theme.id}>
                {theme.name} ·{" "}
                {theme.source === "built-in" ? t("内置") : t("已上传")}
              </option>
            ))}
          </select>
          {activeTheme?.description && <small>{activeTheme.description}</small>}
        </label>
      </div>

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("背景图片")}</h3>
          <p>{t("使用本地图片或图片链接，并实时预览裁切与遮罩。")}</p>
        </div>

        <div
          className={styles.backgroundSourceGrid}
          role="radiogroup"
          aria-label={t("背景来源")}
        >
          <BackgroundChoice
            label={t("无背景")}
            checked={draftBackground.kind === "none"}
            icon={<ImageIcon size={18} />}
            disabled={safeMode}
            onSelect={() => updateBackground({ kind: "none" })}
          />
          <BackgroundChoice
            label={t("本地图片")}
            checked={draftBackground.kind === "upload"}
            icon={<Upload size={18} />}
            disabled={safeMode}
            onSelect={() => {
              if (catalog.userBackgroundUrl) {
                updateBackground({ kind: "upload", url: "" });
              } else {
                uploadInputRef.current?.click();
              }
            }}
          />
          <BackgroundChoice
            label={t("图片链接")}
            checked={draftBackground.kind === "url"}
            icon={<Link2 size={18} />}
            disabled={safeMode}
            onSelect={() => updateBackground({ kind: "url" })}
          />
          {supportsThemeBackground && (
            <BackgroundChoice
              label={t("主题自带")}
              checked={draftBackground.kind === "theme"}
              icon={<Palette size={18} />}
              disabled={safeMode}
              onSelect={() => updateBackground({ kind: "theme", url: "" })}
            />
          )}
        </div>

        <input
          ref={uploadInputRef}
          className={styles.hiddenFileInput}
          type="file"
          accept={[...acceptedBackgroundTypes].join(",")}
          tabIndex={-1}
          aria-hidden="true"
          disabled={safeMode || backgroundBusy !== null}
          onChange={(event) =>
            void handleBackgroundUpload(event.currentTarget.files?.[0])
          }
        />

        {draftBackground.kind === "upload" && (
          <div className={styles.backgroundSourcePanel}>
            <div>
              <strong>
                {catalog.userBackgroundUrl
                  ? t("已上传背景图片")
                  : t("尚未上传图片")}
              </strong>
              <span>{t("支持 PNG、JPEG、WebP、GIF、AVIF，最大 8 MB。")}</span>
            </div>
            <div className={styles.backgroundSourceActions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={backgroundBusy === "upload"}
                disabled={safeMode || backgroundBusy !== null}
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload size={15} />
                {catalog.userBackgroundUrl ? t("替换图片") : t("选择图片")}
              </Button>
              {catalog.userBackgroundUrl && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={backgroundBusy === "remove"}
                  disabled={safeMode || backgroundBusy !== null}
                  onClick={() => void handleBackgroundRemoval()}
                >
                  <Trash2 size={15} />
                  {t("移除")}
                </Button>
              )}
            </div>
          </div>
        )}

        {draftBackground.kind === "url" && (
          <label className={styles.backgroundUrlField}>
            <span>{t("图片链接")}</span>
            <input
              type="url"
              inputMode="url"
              value={draftBackground.url}
              placeholder="https://example.com/background.jpg"
              disabled={safeMode}
              aria-invalid={
                draftBackground.url.length > 0 &&
                !isRemoteBackgroundUrl(draftBackground.url)
              }
              onChange={(event) =>
                updateBackground({ url: event.currentTarget.value })
              }
            />
            <small>
              {t("仅保存 http/https 地址；取色由浏览器直连，不经过服务器代理。")}
            </small>
          </label>
        )}

        {draftBackground.kind !== "none" && (
          <>
            <div
              className={styles.backgroundPreview}
              data-empty={backgroundPreviewUrl ? undefined : "true"}
              role="img"
              aria-label={t("背景预览")}
            >
              {backgroundPreviewUrl ? (
                <>
                  <span
                    className={styles.backgroundPreviewImage}
                    style={{
                      backgroundImage: `url(${JSON.stringify(
                        backgroundPreviewUrl
                      )})`,
                      backgroundPosition: draftBackground.position,
                      backgroundRepeat:
                        draftBackground.fit === "tile" ? "repeat" : "no-repeat",
                      backgroundSize:
                        draftBackground.fit === "tile"
                          ? "auto"
                          : draftBackground.fit,
                      filter: `blur(${draftBackground.blur}px)`
                    }}
                  />
                  <span
                    className={styles.backgroundPreviewOverlay}
                    style={{
                      opacity: draftBackground.overlay
                    }}
                  />
                </>
              ) : (
                <span className={styles.backgroundPreviewEmpty}>
                  {draftBackground.kind === "url"
                    ? t("输入有效链接后显示预览")
                    : t("选择图片后显示预览")}
                </span>
              )}
            </div>

            <div className={styles.backgroundTuningGrid}>
              <label>
                <span>{t("填充方式")}</span>
                <select
                  value={draftBackground.fit}
                  disabled={safeMode}
                  onChange={(event) =>
                    updateBackground({
                      fit: event.currentTarget
                        .value as BackgroundSettings["fit"]
                    })
                  }
                >
                  <option value="cover">{t("覆盖")}</option>
                  <option value="contain">{t("完整显示")}</option>
                  <option value="tile">{t("平铺")}</option>
                </select>
              </label>
              <label>
                <span>{t("对齐位置")}</span>
                <select
                  value={knownBackgroundPosition(draftBackground.position)}
                  disabled={safeMode}
                  onChange={(event) =>
                    updateBackground({ position: event.currentTarget.value })
                  }
                >
                  <option value="center">{t("居中")}</option>
                  <option value="top">{t("顶部")}</option>
                  <option value="bottom">{t("底部")}</option>
                  <option value="left">{t("左侧")}</option>
                  <option value="right">{t("右侧")}</option>
                </select>
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("遮罩")}
                  <output>{Math.round(draftBackground.overlay * 100)}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="1"
                  value={Math.round(draftBackground.overlay * 100)}
                  disabled={safeMode}
                  onChange={(event) =>
                    updateBackground({
                      overlay: Number(event.currentTarget.value) / 100
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("模糊")}
                  <output>{draftBackground.blur}px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  value={draftBackground.blur}
                  disabled={safeMode}
                  onChange={(event) =>
                    updateBackground({
                      blur: Number(event.currentTarget.value)
                    })
                  }
                />
              </label>
            </div>

            <div className={styles.extractColorRow}>
              <div>
                <strong>{t("从图片生成配色")}</strong>
                <span>
                  {t("提取结果会填入下方四个颜色，不会覆盖主题包文件。")}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={backgroundBusy === "extract"}
                loadingLabel={t("提取中…")}
                disabled={
                  safeMode ||
                  backgroundBusy !== null ||
                  !backgroundPreviewUrl
                }
                onClick={() => void extractBackgroundColors()}
              >
                <Sparkles size={15} />
                {t("提取主题色")}
              </Button>
            </div>
          </>
        )}

        {backgroundError !== null && (
          <div className={styles.backgroundError}>
            <ErrorBanner
              error={backgroundError}
              onDismiss={() => setBackgroundError(null)}
            />
            {backgroundPreviewUrl && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={safeMode || backgroundBusy !== null}
                onClick={() => void extractBackgroundColors()}
              >
                {t("重试取色")}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("自定义颜色")}</h3>
          <p>
            {t(
              "开启时四色覆盖主题包颜色；关闭后继续使用主题包原有配色。"
            )}
          </p>
        </div>
        <div className={styles.customColorToggle}>
          <div>
            <strong>{t("使用自定义颜色")}</strong>
            <span>
              {draftMaterial.enabled
                ? t("当前优先使用下方四色")
                : t("当前使用主题包配色")}
            </span>
          </div>
          <Switch
            label={t("使用自定义颜色")}
            checked={draftMaterial.enabled}
            disabled={safeMode}
            onClick={() =>
              setDraftMaterial({
                ...draftMaterial,
                enabled: !draftMaterial.enabled
              })
            }
          />
        </div>
        <div
          className={styles.colorRoleList}
          data-disabled={!draftMaterial.enabled ? "true" : undefined}
        >
          {colorRoles.map(({ role, label, description }) => {
            const color = draftMaterial.colors[role];
            const inputId = `theme-color-${role}`;
            return (
              <div className={styles.colorRoleRow} key={role}>
                <label className={styles.colorRoleCopy} htmlFor={inputId}>
                  <strong>{t(label)}</strong>
                  <span>{t(description)}</span>
                </label>
                <label
                  className={styles.colorWell}
                  style={{ "--color-value": color } as CSSProperties}
                  aria-label={t("选择{{name}}", { name: t(label) })}
                >
                  <input
                    id={inputId}
                    type="color"
                    value={validColorValue(color)}
                    disabled={safeMode || !draftMaterial.enabled}
                    onChange={(event) => updateColor(role, event.target.value)}
                  />
                </label>
                <input
                  key={`${role}-${color}`}
                  className={styles.hexInput}
                  aria-label={t("{{name}}十六进制颜色", { name: t(label) })}
                  defaultValue={color.toUpperCase()}
                  disabled={safeMode || !draftMaterial.enabled}
                  spellCheck={false}
                  maxLength={7}
                  pattern="#[0-9A-Fa-f]{6}"
                  onBlur={(event) => {
                    if (/^#[\da-f]{6}$/i.test(event.target.value)) {
                      updateColor(role, event.target.value);
                    } else {
                      event.target.value = color.toUpperCase();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("预设色彩盘")}</h3>
          <p>{t("选择一组协调色彩，也可以再单独微调。")}</p>
        </div>
        <div className={styles.paletteGrid}>
          {themeColorPresets.map((preset) => {
            const selected = draftMaterial.presetId === preset.id;
            return (
              <button
                key={preset.id}
                className={ui(
                  styles.paletteChoice,
                  selected && styles.paletteSelected
                )}
                type="button"
                aria-pressed={selected}
                aria-label={`${t(preset.label)}：${t(preset.description)}`}
                disabled={safeMode || !draftMaterial.enabled}
                onClick={() =>
                  setDraftMaterial({
                    enabled: true,
                    colors: { ...preset.colors },
                    presetId: preset.id
                  })
                }
              >
                <span className={styles.paletteSwatches} aria-hidden="true">
                  {Object.values(preset.colors).map((color, index) => (
                    <i key={`${preset.id}-${index}`} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span>{t(preset.label)}</span>
                {selected && <Check size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.appearanceActions}>
        <Button
          type="button"
          variant="secondary"
          disabled={safeMode}
          onClick={restoreDefaults}
        >
          <RotateCcw size={16} />
          {t("恢复默认")}
        </Button>
        <Button
          type="button"
          loading={saving}
          loadingLabel={t("应用中…")}
          disabled={safeMode}
          onClick={() => void saveAppearance()}
        >
          {t("应用外观")}
        </Button>
      </div>
    </section>
  );
}

function ModeChoice({
  label,
  value,
  checked,
  icon,
  onSelect
}: {
  label: string;
  value: ThemePreferences["colorMode"];
  checked: boolean;
  icon: ReactNode;
  onSelect: () => void;
}) {
  return (
    <label className={checked ? styles.modeSelected : undefined}>
      <input
        type="radio"
        name="color-mode"
        value={value}
        checked={checked}
        onChange={onSelect}
      />
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
    </label>
  );
}

function BackgroundChoice({
  label,
  checked,
  icon,
  disabled,
  onSelect
}: {
  label: string;
  checked: boolean;
  icon: ReactNode;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={ui(
        styles.backgroundSourceChoice,
        checked && styles.backgroundSourceSelected
      )}
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
      {checked && <Check size={15} aria-hidden="true" />}
    </button>
  );
}

function defaultBackgroundSettings(): BackgroundSettings {
  return {
    kind: "none",
    url: "",
    fit: "cover",
    position: "center",
    overlay: 0.18,
    blur: 0
  };
}

function validateBackgroundFile(file: File): void {
  if (!acceptedBackgroundTypes.has(file.type)) {
    throw new Error(t("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。"));
  }
  if (file.size <= 0 || file.size > maximumBackgroundBytes) {
    throw new Error(t("背景图片必须小于 8 MB。"));
  }
}

function isRemoteBackgroundUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertBackgroundReady(
  background: BackgroundSettings,
  uploadedUrl: string | undefined
): void {
  if (background.kind === "url" && !isRemoteBackgroundUrl(background.url)) {
    throw new Error(t("请输入有效的 http 或 https 图片链接。"));
  }
  if (background.kind === "upload" && !uploadedUrl) {
    throw new Error(t("请先选择并上传一张背景图片。"));
  }
}

function resolveBackgroundPreviewUrl(
  background: BackgroundSettings,
  uploadedUrl: string | undefined,
  themeUrl: string | undefined
): string | null {
  if (background.kind === "upload") return uploadedUrl ?? null;
  if (background.kind === "theme") return themeUrl ?? null;
  if (background.kind === "url" && isRemoteBackgroundUrl(background.url)) {
    return background.url;
  }
  return null;
}

function backgroundExtractionSource(
  background: BackgroundSettings,
  localFile: File | null,
  uploadedUrl: string | undefined,
  themeUrl: string | undefined
): File | string {
  if (background.kind === "upload") {
    if (localFile) return localFile;
    if (uploadedUrl) return uploadedUrl;
    throw new Error(t("请先选择并上传一张背景图片。"));
  }
  if (background.kind === "url") {
    if (isRemoteBackgroundUrl(background.url)) return background.url;
    throw new Error(t("请输入有效的 http 或 https 图片链接。"));
  }
  if (background.kind === "theme" && themeUrl) return themeUrl;
  throw new Error(t("当前没有可用于取色的背景图片。"));
}

async function extractColorsFromImage(
  source: File | string
): Promise<MaterialThemeSettings["colors"]> {
  const localObjectUrl = source instanceof File;
  const sourceUrl = localObjectUrl ? URL.createObjectURL(source) : source;
  try {
    const image = await loadImageForColorExtraction(sourceUrl, !localObjectUrl);
    const maximumDimension = 96;
    const scale = Math.min(
      1,
      maximumDimension / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true
    });
    if (!context) {
      throw new Error(t("当前浏览器无法分析图片颜色。"));
    }
    context.drawImage(image, 0, 0, width, height);
    try {
      return extractThemeSeedColors(
        context.getImageData(0, 0, width, height)
      );
    } catch (reason) {
      if (
        reason instanceof DOMException &&
        reason.name === "SecurityError"
      ) {
        throw new Error(
          t("图片服务器未允许跨域取色；背景仍可使用，也可改用本地上传。")
        );
      }
      throw reason;
    }
  } finally {
    if (localObjectUrl) URL.revokeObjectURL(sourceUrl);
  }
}

async function loadImageForColorExtraction(
  sourceUrl: string,
  corsRequired: boolean
): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      image.src = "";
      reject(new Error(t("图片加载超时，请检查链接后重试。")));
    }, 15_000);

    const finish = (
      action: () => void
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      action();
    };
    image.onload = () =>
      finish(() => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          resolve(image);
        } else {
          reject(new Error(t("图片没有可读取的尺寸。")));
        }
      });
    image.onerror = () =>
      finish(() =>
        reject(
          new Error(
            corsRequired
              ? t(
                  "无法读取远程图片；请确认链接可访问且图片服务器允许 CORS，或改用本地上传。"
                )
              : t("无法读取该图片，请换用受支持的图片格式。")
          )
        )
      );
    if (corsRequired) {
      image.crossOrigin = "anonymous";
      image.referrerPolicy = "no-referrer";
    }
    image.decoding = "async";
    image.src = sourceUrl;
  });
}

function knownBackgroundPosition(value: string): string {
  return ["center", "top", "bottom", "left", "right"].includes(value)
    ? value
    : "center";
}

function validColorValue(color: string) {
  return /^#[\da-f]{6}$/i.test(color) ? color : "#54545B";
}
