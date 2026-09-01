import { describe, expect, it } from "vitest";
import {
  applyMaterialThemeSettingsToRoot,
  createLegacyThemeTokenMap,
  createMaterialThemeTokens,
  defaultMaterialThemeSettings,
  extractThemeSeedColors,
  legacyMaterialThemeTokenNames,
  materialThemeSettingsStorageKey,
  materialThemeTokenNames,
  normalizeMaterialThemeSettings,
  persistMaterialThemeSettings,
  readMaterialThemeSettings,
  themeColorPresets,
  themeColorRoles,
  type MaterialThemeSettings
} from "./theme-customization";

describe("Material theme presets", () => {
  it("provides five complete optional four-role palettes", () => {
    expect(themeColorPresets).toHaveLength(5);
    expect(new Set(themeColorPresets.map((preset) => preset.id)).size).toBe(5);
    expect(themeColorPresets.some((preset) => preset.id === "warm-studio")).toBe(
      false
    );
    expect(defaultMaterialThemeSettings).toMatchObject({
      enabled: false,
      presetId: "graphite"
    });
    for (const preset of themeColorPresets) {
      for (const role of themeColorRoles) {
        expect(preset.colors[role]).toMatch(/^#[\dA-F]{6}$/);
      }
    }
  });

  it("keeps independently edited roles and leaves preset mode", () => {
    const custom = normalizeMaterialThemeSettings({
      ...defaultMaterialThemeSettings,
      colors: {
        ...defaultMaterialThemeSettings.colors,
        secondary: "#123456"
      }
    });

    expect(custom.colors.primary).toBe(
      defaultMaterialThemeSettings.colors.primary
    );
    expect(custom.colors.secondary).toBe("#123456");
    expect(custom.presetId).toBeNull();
  });
});

describe("image-derived theme colors", () => {
  it("extracts three distinct accents and a restrained neutral", () => {
    const pixels = new Uint8ClampedArray([
      190, 58, 72, 255,
      190, 58, 72, 255,
      45, 118, 164, 255,
      45, 118, 164, 255,
      76, 134, 82, 255,
      76, 134, 82, 255,
      130, 124, 118, 255,
      130, 124, 118, 255
    ]);

    const colors = extractThemeSeedColors({
      data: pixels,
      width: 4,
      height: 2
    });

    expect(Object.values(colors)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^#[\dA-F]{6}$/)
      ])
    );
    expect(new Set([
      colors.primary,
      colors.secondary,
      colors.tertiary
    ]).size).toBe(3);
    const neutralChannels = [1, 3, 5].map((offset) =>
      Number.parseInt(colors.neutral.slice(offset, offset + 2), 16)
    );
    expect(Math.max(...neutralChannels) - Math.min(...neutralChannels)).toBeLessThan(
      32
    );
  });

  it("rejects empty or malformed pixel buffers", () => {
    expect(() =>
      extractThemeSeedColors({ data: [], width: 2, height: 2 })
    ).toThrow(/malformed/i);
  });
});

describe("Material theme persistence", () => {
  it("round-trips all four roles through local storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      }
    };
    const settings: MaterialThemeSettings = {
      enabled: true,
      presetId: null,
      colors: {
        primary: "#112233",
        secondary: "#445566",
        tertiary: "#778899",
        neutral: "#AABBCC"
      }
    };

    persistMaterialThemeSettings(settings, storage);

    expect(values.has(materialThemeSettingsStorageKey)).toBe(true);
    expect(readMaterialThemeSettings(storage)).toEqual(settings);
  });

  it("drops legacy palette storage instead of reviving retired colors", () => {
    const legacy = JSON.stringify({
      version: 1,
      enabled: true,
      presetId: "warm-studio",
      colors: {
        primary: "#4F5D8C",
        secondary: "#807093",
        tertiary: "#5F785F",
        neutral: "#817A74"
      }
    });
    const storage = {
      getItem(key: string) {
        return key === materialThemeSettingsStorageKey ? legacy : null;
      }
    };

    expect(readMaterialThemeSettings(storage)).toEqual(
      defaultMaterialThemeSettings
    );
  });
});

describe("Material theme token bridge", () => {
  it("generates light and dark MD3 roles plus legacy aliases", () => {
    const light = createMaterialThemeTokens(
      defaultMaterialThemeSettings,
      "light"
    );
    const dark = createMaterialThemeTokens(
      defaultMaterialThemeSettings,
      "dark"
    );
    const legacy = createLegacyThemeTokenMap(light);

    expect(light["--md-sys-color-primary"]).not.toBe(
      light["--md-sys-color-secondary"]
    );
    expect(light["--md-sys-color-tertiary"]).toBeTruthy();
    expect(light["--md-sys-color-background"]).not.toBe(
      dark["--md-sys-color-background"]
    );
    expect(legacy["--lime"]).toBe(light["--md-sys-color-primary"]);
    expect(legacy["--bg"]).toBe(light["--md-sys-color-background"]);
  });

  it("removes MD3 and legacy inline overrides when disabled", () => {
    const styles = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty(name: string, value: string) {
          styles.set(name, value);
        },
        removeProperty(name: string) {
          const previous = styles.get(name) ?? "";
          styles.delete(name);
          return previous;
        }
      }
    } as unknown as HTMLElement;

    const enabledSettings = {
      ...defaultMaterialThemeSettings,
      enabled: true
    };
    applyMaterialThemeSettingsToRoot(
      root,
      enabledSettings,
      "light"
    );
    expect(styles.get("--md-sys-color-primary")).toBeTruthy();
    expect(styles.get("--bg")).toBeTruthy();

    applyMaterialThemeSettingsToRoot(
      root,
      defaultMaterialThemeSettings,
      "light"
    );

    for (const token of [
      ...materialThemeTokenNames,
      ...legacyMaterialThemeTokenNames
    ]) {
      expect(styles.has(token)).toBe(false);
    }
    expect(root.dataset.materialTheme).toBeUndefined();
    expect(root.dataset.materialPreset).toBeUndefined();
  });

  it("does not overwrite theme package layout, shadow, or shape tokens", () => {
    const styles = new Map<string, string>([
      ["--sidebar", "64px"],
      ["--shadow", "0 18px 48px rgb(0 0 0 / 12%)"],
      ["--radius", "22px"]
    ]);
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty(name: string, value: string) {
          styles.set(name, value);
        },
        removeProperty(name: string) {
          const previous = styles.get(name) ?? "";
          styles.delete(name);
          return previous;
        }
      }
    } as unknown as HTMLElement;

    applyMaterialThemeSettingsToRoot(
      root,
      { ...defaultMaterialThemeSettings, enabled: true },
      "dark"
    );

    expect(styles.get("--sidebar")).toBe("64px");
    expect(styles.get("--shadow")).toBe(
      "0 18px 48px rgb(0 0 0 / 12%)"
    );
    expect(styles.get("--radius")).toBe("22px");
  });
});
