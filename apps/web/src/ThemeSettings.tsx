import { Monitor, Moon, Palette, RotateCcw, ShieldCheck, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ThemePreferences } from "@pi-web/protocol";
import {
  Button,
  ErrorBanner,
  LoadingSpinner,
  useToast
} from "./components";
import {
  defaultMaterialThemeSettings,
  useTheme,
  type MaterialThemeSettings
} from "./theme";
import { t } from "./i18n";
import styles from "./pages/SettingsPage.module.css";
import {
  ThemeBackgroundEditor,
  type BackgroundBusyState
} from "./features/theme-settings/ThemeBackgroundEditor";
import { ThemeColorEditor } from "./features/theme-settings/ThemeColorEditor";
import {
  assertBackgroundReady,
  backgroundExtractionSource,
  extractColorsFromImage,
  resolveBackgroundPreviewUrl,
  validateBackgroundFile
} from "./features/theme-settings/theme-image-colors";

type BackgroundSettings = ThemePreferences["background"];

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

      <ThemeBackgroundEditor
        value={draftBackground}
        busy={backgroundBusy}
        error={backgroundError}
        safeMode={safeMode}
        previewUrl={backgroundPreviewUrl}
        supportsThemeBackground={supportsThemeBackground}
        uploadedUrl={catalog.userBackgroundUrl}
        uploadInputRef={uploadInputRef}
        onDismissError={() => setBackgroundError(null)}
        onChange={updateBackground}
        onUpload={handleBackgroundUpload}
        onRemove={handleBackgroundRemoval}
        onExtract={extractBackgroundColors}
      />

      <ThemeColorEditor
        value={draftMaterial}
        disabled={safeMode}
        onChange={setDraftMaterial}
      />

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

function defaultBackgroundSettings(): BackgroundSettings {
  return {
    kind: "none",
    url: "",
    fit: "cover",
    position: "center",
    overlay: 0.18,
    blur: 0,
    surfaceOpacity: 0.22,
    panelOpacity: 0.58,
    toolbarOpacity: 0.48,
    interfaceBlur: 8
  };
}
