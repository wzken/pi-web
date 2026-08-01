import { describe, expect, it } from "vitest";
import {
  applyMaterialThemeSettingsToRoot,
  applyThemePackMduiTokensToRoot,
  createLegacyThemeTokenMap,
  createMaterialThemeTokens,
  createMduiThemeTokens,
  createThemePackMduiTokens,
  defaultMaterialThemeSettings,
  extractThemeSeedColors,
  legacyMaterialThemeTokenNames,
  materialThemeSettingsStorageKey,
  materialThemeTokenNames,
  mduiThemeTokenNames,
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
  it("generates light and dark MD3 roles plus MDUI and legacy aliases", () => {
    const light = createMaterialThemeTokens(
      defaultMaterialThemeSettings,
      "light"
    );
    const dark = createMaterialThemeTokens(
      defaultMaterialThemeSettings,
      "dark"
    );
    const mdui = createMduiThemeTokens(light);
    const legacy = createLegacyThemeTokenMap(light);

    expect(light["--md-sys-color-primary"]).not.toBe(
      light["--md-sys-color-secondary"]
    );
    expect(light["--md-sys-color-tertiary"]).toBeTruthy();
    expect(light["--md-sys-color-background"]).not.toBe(
      dark["--md-sys-color-background"]
    );
    expect(mdui["--mdui-color-primary"]).toMatch(/^\d+, \d+, \d+$/);
    expect(mdui["--mdui-color-secondary"]).not.toBe(
      mdui["--mdui-color-primary"]
    );
    expect(mdui["--mdui-color-surface"]).not.toBe(
      mdui["--mdui-color-primary"]
    );
    expect(mdui["--mdui-shape-corner-large"]).toBeUndefined();
    expect(legacy["--lime"]).toBe(light["--md-sys-color-primary"]);
    expect(legacy["--bg"]).toBe(light["--md-sys-color-background"]);
  });

  it("removes MD3, MDUI, and legacy inline overrides when disabled", () => {
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
    expect(styles.get("--mdui-color-primary")).toBeTruthy();
    expect(styles.get("--bg")).toBeTruthy();

    applyMaterialThemeSettingsToRoot(
      root,
      defaultMaterialThemeSettings,
      "light"
    );

    for (const token of [
      ...materialThemeTokenNames,
      ...mduiThemeTokenNames,
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
      ["--mdui-shape-corner-large", "22px"]
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
    expect(styles.get("--mdui-shape-corner-large")).toBe("22px");
  });
});

describe("legacy theme package MDUI bridge", () => {
  it("maps package colors, surfaces, and shapes to MDUI channels", () => {
    const tokens = createThemePackMduiTokens({
      "--bg": "#0a0b0c",
      "--bg-raised": "rgb(17 18 19)",
      "--panel": "#141516",
      "--panel-2": "#202122",
      "--panel-3": "#303132",
      "--line": "#404142",
      "--line-soft": "#505152",
      "--text": "#f1f2f3",
      "--text-soft": "rgba(201, 202, 203, 0.8)",
      "--lime": "#abc",
      "--lime-ink": "#102030",
      "--teal": "rgb(25%, 50%, 75%)",
      "--violet": "#665577",
      "--red": "#cc3344",
      "--blue": "#446688",
      "--radius": "18px",
      "--radius-sm": "7px"
    });

    expect(tokens["--mdui-color-primary"]).toBe("170, 187, 204");
    expect(tokens["--mdui-color-surface"]).toBe("10, 11, 12");
    expect(tokens["--mdui-color-surface-container-low"]).toBe("20, 21, 22");
    expect(tokens["--mdui-color-on-surface-variant"]).toBe("201, 202, 203");
    expect(tokens["--mdui-color-tertiary"]).toBe("64, 128, 191");
    expect(tokens["--mdui-shape-corner-extra-large"]).toBe("18px");
    expect(tokens["--mdui-shape-corner-small"]).toBe("7px");
  });

  it("skips unsupported color expressions without invalidating other roles", () => {
    const tokens = createThemePackMduiTokens({
      "--lime": "color-mix(in srgb, red 60%, blue)",
      "--text": "#112233",
      "--radius": "var(--theme-radius)"
    });

    expect(tokens["--mdui-color-primary"]).toBeUndefined();
    expect(tokens["--mdui-color-on-surface"]).toBe("17, 34, 51");
    expect(tokens["--mdui-shape-corner-large"]).toBe(
      "var(--theme-radius)"
    );
  });

  it("replaces custom-palette MDUI values while preserving legacy theme tokens", () => {
    const styles = new Map<string, string>([
      ["--bg", "#010203"],
      ["--font-ui", "Theme Sans"],
      ["--mdui-color-primary", "1, 1, 1"]
    ]);
    const root = {
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

    applyThemePackMduiTokensToRoot(root, {
      "--lime": "#abcdef",
      "--text": "#202122"
    });

    expect(styles.get("--mdui-color-primary")).toBe("171, 205, 239");
    expect(styles.get("--mdui-color-on-surface")).toBe("32, 33, 34");
    expect(styles.get("--bg")).toBe("#010203");
    expect(styles.get("--font-ui")).toBe("Theme Sans");
  });
});
