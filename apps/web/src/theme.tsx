import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import type {
  InstalledTheme,
  ThemeCatalog,
  ThemePreferences
} from "@pi-web/protocol";
import { themeTokenNames } from "@pi-web/protocol/theme-tokens";
import { api, isAbortError, jsonBody } from "./api";
import { useAuth } from "./auth";
import { applySystemColorScheme } from "./system-color-scheme";
import {
  applyMaterialThemeSettingsToRoot,
  clearMaterialThemeTokens,
  materialThemeSettingsStorageKey,
  normalizeMaterialThemeSettings,
  persistMaterialThemeSettings,
  readMaterialThemeSettings,
  type MaterialThemeSettings
} from "./theme-customization";

const defaultThemeId = "pi-neutral";

interface ThemeContextValue {
  catalog: ThemeCatalog | null;
  activeTheme: InstalledTheme | null;
  resolvedColorScheme: "light" | "dark";
  materialThemeSettings: MaterialThemeSettings;
  effectiveMaterialThemeSettings: MaterialThemeSettings;
  loading: boolean;
  safeMode: boolean;
  previewPreferences(value: ThemePreferences | null): void;
  updatePreferences(value: ThemePreferences): Promise<ThemeCatalog>;
  previewMaterialThemeSettings(value: MaterialThemeSettings | null): void;
  uploadBackground(file: File): Promise<ThemeCatalog>;
  removeBackground(): Promise<ThemeCatalog>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeColorModeStorageKey = "pi-web:color-mode";

export function ThemeProvider({ children }: PropsWithChildren) {
  const { authenticated } = useAuth();
  const [catalog, setCatalog] = useState<ThemeCatalog | null>(null);
  const [preferencePreview, setPreferencePreview] =
    useState<ThemePreferences | null>(null);
  const [materialThemeSettings, setMaterialThemeSettings] =
    useState<MaterialThemeSettings>(() => readMaterialThemeSettings());
  const [materialThemePreview, setMaterialThemePreview] =
    useState<MaterialThemeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemColorScheme, setSystemColorScheme] = useState<"light" | "dark">(
    () => systemScheme()
  );
  const safeMode = useMemo(
    () => new URLSearchParams(window.location.search).get("safe-theme") === "1",
    []
  );

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    void api<ThemeCatalog>("/api/themes", { signal: controller.signal })
      .then((value) => {
        setCatalog(value);
        setMaterialThemeSettings(
          persistMaterialThemeSettings(value.preferences.materialTheme)
        );
      })
      .catch((reason) => {
        if (isAbortError(reason)) return;
        // The base stylesheet is the complete built-in fallback, including login.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authenticated]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemColorScheme(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const updateFromStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        event.key === materialThemeSettingsStorageKey
      ) {
        // Local storage mirrors the server preference so already-open tabs can
        // update immediately; the server catalog remains the durable source.
        setMaterialThemeSettings(readMaterialThemeSettings());
        setMaterialThemePreview(null);
      }
    };
    window.addEventListener("storage", updateFromStorage);
    return () => window.removeEventListener("storage", updateFromStorage);
  }, []);

  useEffect(() => {
    if (!catalog) return;
    rememberColorMode(catalog.preferences.colorMode);
  }, [catalog]);

  const effectiveCatalog = useMemo<ThemeCatalog | null>(() => {
    if (!catalog || !preferencePreview) return catalog;
    return { ...catalog, preferences: preferencePreview };
  }, [catalog, preferencePreview]);

  const resolvedColorScheme = useMemo<"light" | "dark">(() => {
    if (safeMode) return "light";
    const mode = effectiveCatalog?.preferences.colorMode ?? storedColorMode();
    return resolveColorScheme(mode, systemColorScheme);
  }, [effectiveCatalog?.preferences.colorMode, safeMode, systemColorScheme]);

  const activeTheme = useMemo(() => {
    return resolveActiveTheme(effectiveCatalog, resolvedColorScheme, safeMode);
  }, [effectiveCatalog, resolvedColorScheme, safeMode]);

  const effectiveMaterialThemeSettings =
    materialThemePreview ?? materialThemeSettings;

  useEffect(() => {
    return () => resetThemeRoot(document.documentElement);
  }, []);

  useLayoutEffect(() => {
    if (loading && !effectiveCatalog) {
      const root = document.documentElement;
      applySystemColorScheme(root, resolvedColorScheme);
      const themeColor = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );
      if (themeColor) {
        themeColor.content =
          resolvedColorScheme === "dark" ? "#0c1110" : "#f3f5f0";
      }
      return;
    }
    applyTheme(
      activeTheme,
      safeMode ? null : effectiveCatalog,
      resolvedColorScheme
    );
    const materialTokens =
      safeMode || !effectiveMaterialThemeSettings.enabled
      ? null
      : applyMaterialThemeSettingsToRoot(
          document.documentElement,
          effectiveMaterialThemeSettings,
          resolvedColorScheme
        );
    const themeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]'
    );
    if (themeColor && materialTokens) {
      themeColor.content = materialTokens["--md-sys-color-surface"] ?? "";
    }
    return () => {
      document.getElementById("pi-web-theme-css")?.remove();
    };
  }, [
    activeTheme,
    effectiveCatalog,
    effectiveMaterialThemeSettings,
    loading,
    resolvedColorScheme,
    safeMode
  ]);

  const updatePreferences = useCallback(async (value: ThemePreferences) => {
    const next = await api<ThemeCatalog>("/api/themes/preferences", {
      method: "PUT",
      ...jsonBody(value)
    });
    setCatalog(next);
    setMaterialThemeSettings(
      persistMaterialThemeSettings(next.preferences.materialTheme)
    );
    setMaterialThemePreview(null);
    setPreferencePreview(null);
    return next;
  }, []);

  const previewPreferences = useCallback((value: ThemePreferences | null) => {
    setPreferencePreview(value);
  }, []);

  const previewMaterialThemeSettings = useCallback(
    (value: MaterialThemeSettings | null) => {
      setMaterialThemePreview(
        value ? normalizeMaterialThemeSettings(value) : null
      );
    },
    []
  );

  const uploadBackground = useCallback(async (file: File) => {
    const next = await api<ThemeCatalog>("/api/themes/background", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file
    });
    setCatalog(next);
    return next;
  }, []);

  const removeBackground = useCallback(async () => {
    const next = await api<ThemeCatalog>("/api/themes/background", {
      method: "DELETE"
    });
    setCatalog(next);
    return next;
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      catalog,
      activeTheme,
      resolvedColorScheme,
      materialThemeSettings,
      effectiveMaterialThemeSettings,
      loading,
      safeMode,
      previewPreferences,
      updatePreferences,
      previewMaterialThemeSettings,
      uploadBackground,
      removeBackground
    }),
    [
      activeTheme,
      catalog,
      effectiveMaterialThemeSettings,
      loading,
      materialThemeSettings,
      previewMaterialThemeSettings,
      previewPreferences,
      removeBackground,
      resolvedColorScheme,
      safeMode,
      updatePreferences,
      uploadBackground
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

export function resolveActiveTheme(
  catalog: ThemeCatalog | null,
  resolvedColorScheme: "light" | "dark",
  safeMode = false
): InstalledTheme | null {
  if (!catalog) return null;
  if (safeMode) {
    return catalog.themes.find((theme) => theme.id === defaultThemeId) ?? null;
  }
  const selected =
    catalog.themes.find((theme) => theme.id === catalog.preferences.themeId) ??
    catalog.themes.find((theme) => theme.id === defaultThemeId) ??
    null;
  if (!selected || themeSupportsColorScheme(selected, resolvedColorScheme)) {
    return selected;
  }
  return (
    catalog.themes.find(
      (theme) =>
        theme.id === defaultThemeId &&
        themeSupportsColorScheme(theme, resolvedColorScheme)
    ) ??
    catalog.themes.find(
      (theme) => themeSupportsColorScheme(theme, resolvedColorScheme)
    ) ??
    selected
  );
}

export function themeSupportsColorScheme(
  theme: InstalledTheme,
  colorScheme: "light" | "dark"
): boolean {
  return theme.schemaVersion === 2
    ? Boolean(theme.schemes[colorScheme])
    : theme.colorScheme === colorScheme;
}

export function themeTokensForScheme(
  theme: InstalledTheme,
  colorScheme: "light" | "dark"
): Record<string, string> {
  if (theme.schemaVersion === 2) return theme.schemes[colorScheme].tokens;
  return theme.tokens;
}

export function resolveColorScheme(
  mode: ThemePreferences["colorMode"],
  systemColorScheme: "light" | "dark"
): "light" | "dark" {
  return mode === "system" ? systemColorScheme : mode;
}

function applyTheme(
  theme: InstalledTheme | null,
  catalog: ThemeCatalog | null,
  resolvedColorScheme: "light" | "dark"
): void {
  const root = document.documentElement;
  const linkId = "pi-web-theme-css";
  document.getElementById(linkId)?.remove();

  for (const token of themeTokenNames) {
    root.style.removeProperty(token);
  }
  clearMaterialThemeTokens(root);
  root.dataset.colorMode = resolvedColorScheme;
  root.style.colorScheme = resolvedColorScheme;
  const themeColor = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (themeColor) {
    themeColor.content =
      resolvedColorScheme === "dark" ? "#0c1110" : "#f3f5f0";
  }
  if (!theme) {
    root.removeAttribute("data-theme-id");
    root.removeAttribute("data-theme-source");
    clearBackground(root);
    return;
  }

  root.dataset.themeId = theme.id;
  root.dataset.themeSource = theme.source;
  const tokens = themeTokensForScheme(theme, resolvedColorScheme);
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  if (themeColor) {
    themeColor.content =
      tokens["--bg"] ??
      (resolvedColorScheme === "dark" ? "#0c1110" : "#f3f5f0");
  }

  if (theme.cssUrl && catalog) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = theme.cssUrl;
    link.dataset.themeId = theme.id;
    document.head.append(link);
  }

  if (!catalog) {
    clearBackground(root);
    return;
  }
  const preference = catalog.preferences.background;
  const themeBackground = theme.background;
  const imageUrl =
    preference.kind === "theme"
      ? theme.backgroundUrl
      : preference.kind === "upload"
        ? catalog.userBackgroundUrl
        : preference.kind === "url"
          ? preference.url
          : undefined;
  if (!imageUrl) {
    clearBackground(root);
    return;
  }
  const fit = preference.kind === "theme" ? themeBackground?.fit : preference.fit;
  const position =
    preference.kind === "theme" ? themeBackground?.position : preference.position;
  const overlay =
    preference.kind === "theme" ? themeBackground?.overlay : preference.overlay;
  const blur =
    preference.kind === "theme" ? themeBackground?.blur : preference.blur;
  const surfaceOpacity = preference.surfaceOpacity;
  const panelOpacity = preference.panelOpacity;
  const toolbarOpacity = preference.toolbarOpacity;
  const interfaceBlur = preference.interfaceBlur;
  root.dataset.hasBackground = "true";
  root.style.setProperty("--app-background-image", `url(${JSON.stringify(imageUrl)})`);
  root.style.setProperty("--app-background-size", fit === "tile" ? "auto" : fit ?? "cover");
  root.style.setProperty("--app-background-repeat", fit === "tile" ? "repeat" : "no-repeat");
  root.style.setProperty("--app-background-position", position ?? "center");
  root.style.setProperty("--app-background-overlay", String(overlay ?? 0.18));
  root.style.setProperty("--app-background-blur", `${blur ?? 0}px`);
  root.style.setProperty("--app-surface-opacity", String(surfaceOpacity));
  root.style.setProperty("--app-panel-opacity", String(panelOpacity));
  root.style.setProperty("--app-toolbar-opacity", String(toolbarOpacity));
  root.style.setProperty("--app-interface-blur", `${interfaceBlur}px`);
}

export {
  defaultMaterialThemeSettings,
  themeColorPresets,
  type MaterialThemeSettings,
  type ThemeColorRole
} from "./theme-customization";

function systemScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedColorMode(): ThemePreferences["colorMode"] {
  try {
    const value = localStorage.getItem(themeColorModeStorageKey);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    return "system";
  }
}

function rememberColorMode(mode: ThemePreferences["colorMode"]): void {
  try {
    localStorage.setItem(themeColorModeStorageKey, mode);
  } catch {
    // Theme selection still works when persistent browser storage is blocked.
  }
}

function resetThemeRoot(root: HTMLElement): void {
  document.getElementById("pi-web-theme-css")?.remove();
  for (const token of themeTokenNames) root.style.removeProperty(token);
  clearMaterialThemeTokens(root);
  root.removeAttribute("data-theme-id");
  root.removeAttribute("data-theme-source");
  clearBackground(root);
}

function clearBackground(root: HTMLElement): void {
  delete root.dataset.hasBackground;
  for (const name of [
    "--app-background-image",
    "--app-background-size",
    "--app-background-repeat",
    "--app-background-position",
    "--app-background-overlay",
    "--app-background-blur",
    "--app-surface-opacity",
    "--app-panel-opacity",
    "--app-toolbar-opacity",
    "--app-interface-blur"
  ]) {
    root.style.removeProperty(name);
  }
}
