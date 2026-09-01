export type ThemeColorRole =
  | "primary"
  | "secondary"
  | "tertiary"
  | "neutral";

export interface ThemeSeedColors {
  primary: string;
  secondary: string;
  tertiary: string;
  neutral: string;
}

export interface MaterialThemeSettings {
  enabled: boolean;
  colors: ThemeSeedColors;
  presetId: string | null;
}

export interface ThemeColorPreset {
  id: string;
  label: string;
  description: string;
  colors: ThemeSeedColors;
}

export interface ImagePixelData {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export type MaterialColorScheme = "light" | "dark";

export const materialThemeSettingsStorageKey =
  "pi-web:material-theme-settings";
const materialThemeSettingsStorageVersion = 2;
const defaultThemeColorPresetId = "graphite";

export const themeColorRoles: readonly ThemeColorRole[] = [
  "primary",
  "secondary",
  "tertiary",
  "neutral"
];

/** Restrained optional palettes for the settings color picker. */
export const themeColorPresets: readonly ThemeColorPreset[] = [
  {
    id: "graphite",
    label: "石墨灰",
    description: "近中性的灰阶系统，只保留细微冷暖层次。",
    colors: {
      primary: "#54545B",
      secondary: "#69656C",
      tertiary: "#5D6765",
      neutral: "#77777A"
    }
  },
  {
    id: "lavender",
    label: "薰衣草",
    description: "柔和紫色层次，适合安静、低干扰的工作界面。",
    colors: {
      primary: "#76558F",
      secondary: "#8A6F8B",
      tertiary: "#9A5964",
      neutral: "#807A82"
    }
  },
  {
    id: "indigo",
    label: "靛青",
    description: "清晰稳重的蓝靛主色，保留柔和紫色辅助层次。",
    colors: {
      primary: "#44599A",
      secondary: "#62658C",
      tertiary: "#77558A",
      neutral: "#77777E"
    }
  },
  {
    id: "sage",
    label: "鼠尾草",
    description: "自然绿为主，辅以低饱和橄榄与木质色。",
    colors: {
      primary: "#496B50",
      secondary: "#6B6650",
      tertiary: "#765A45",
      neutral: "#777A73"
    }
  },
  {
    id: "coral",
    label: "珊瑚",
    description: "温暖珊瑚主色，适合友好而不过分活跃的强调。",
    colors: {
      primary: "#A34F3E",
      secondary: "#805B53",
      tertiary: "#7B5D2E",
      neutral: "#817873"
    }
  }
];

const defaultPreset = themeColorPresets.find(
  (preset) => preset.id === defaultThemeColorPresetId
)!;

export const defaultMaterialThemeSettings: MaterialThemeSettings = {
  enabled: false,
  colors: { ...defaultPreset.colors },
  presetId: defaultPreset.id
};

const materialColorTokenNames = [
  "--md-sys-color-primary",
  "--md-sys-color-on-primary",
  "--md-sys-color-primary-container",
  "--md-sys-color-on-primary-container",
  "--md-sys-color-inverse-primary",
  "--md-sys-color-primary-fixed",
  "--md-sys-color-primary-fixed-dim",
  "--md-sys-color-on-primary-fixed",
  "--md-sys-color-on-primary-fixed-variant",
  "--md-sys-color-secondary",
  "--md-sys-color-on-secondary",
  "--md-sys-color-secondary-container",
  "--md-sys-color-on-secondary-container",
  "--md-sys-color-secondary-fixed",
  "--md-sys-color-secondary-fixed-dim",
  "--md-sys-color-on-secondary-fixed",
  "--md-sys-color-on-secondary-fixed-variant",
  "--md-sys-color-tertiary",
  "--md-sys-color-on-tertiary",
  "--md-sys-color-tertiary-container",
  "--md-sys-color-on-tertiary-container",
  "--md-sys-color-tertiary-fixed",
  "--md-sys-color-tertiary-fixed-dim",
  "--md-sys-color-on-tertiary-fixed",
  "--md-sys-color-on-tertiary-fixed-variant",
  "--md-sys-color-error",
  "--md-sys-color-on-error",
  "--md-sys-color-error-container",
  "--md-sys-color-on-error-container",
  "--md-sys-color-background",
  "--md-sys-color-on-background",
  "--md-sys-color-surface",
  "--md-sys-color-on-surface",
  "--md-sys-color-surface-variant",
  "--md-sys-color-on-surface-variant",
  "--md-sys-color-surface-dim",
  "--md-sys-color-surface-bright",
  "--md-sys-color-surface-container-lowest",
  "--md-sys-color-surface-container-low",
  "--md-sys-color-surface-container",
  "--md-sys-color-surface-container-high",
  "--md-sys-color-surface-container-highest",
  "--md-sys-color-surface-tint",
  "--md-sys-color-outline",
  "--md-sys-color-outline-variant",
  "--md-sys-color-shadow",
  "--md-sys-color-scrim",
  "--md-sys-color-inverse-surface",
  "--md-sys-color-inverse-on-surface"
] as const;

const materialShapeTokenNames = [
  "--md-sys-shape-corner-none",
  "--md-sys-shape-corner-extra-small",
  "--md-sys-shape-corner-small",
  "--md-sys-shape-corner-medium",
  "--md-sys-shape-corner-large",
  "--md-sys-shape-corner-extra-large",
  "--md-sys-shape-corner-full"
] as const;

const materialStateTokenNames = [
  "--md-sys-state-hover-state-layer-opacity",
  "--md-sys-state-focus-state-layer-opacity",
  "--md-sys-state-pressed-state-layer-opacity",
  "--md-sys-state-dragged-state-layer-opacity"
] as const;

export const materialThemeTokenNames: readonly string[] = [
  ...materialColorTokenNames,
  ...materialShapeTokenNames,
  ...materialStateTokenNames
];

export const legacyMaterialThemeTokenNames = [
  "--bg",
  "--bg-raised",
  "--panel",
  "--panel-2",
  "--panel-3",
  "--line",
  "--line-soft",
  "--text",
  "--text-soft",
  "--text-dim",
  "--lime",
  "--lime-ink",
  "--teal",
  "--violet",
  "--amber",
  "--red",
  "--blue"
] as const;

function getThemeColorPreset(
  id: string | null | undefined
): ThemeColorPreset | null {
  return themeColorPresets.find((preset) => preset.id === id) ?? null;
}

/**
 * Builds four restrained MD3 seed colors from decoded image pixels.
 *
 * Pixel decoding stays in the browser. Remote images must opt into CORS before
 * callers can provide their pixels, so this helper never proxies or fetches a
 * user-provided URL through the Pi Web server.
 */
export function extractThemeSeedColors(
  image: ImagePixelData
): ThemeSeedColors {
  const { data, width, height } = image;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    data.length < width * height * 4
  ) {
    throw new Error("Image pixels are empty or malformed");
  }

  const targetSamples = 4_096;
  const pixelCount = width * height;
  const stride = Math.max(1, Math.ceil(pixelCount / targetSamples));
  const hueBuckets = Array.from({ length: 24 }, () => ({
    red: 0,
    green: 0,
    blue: 0,
    weight: 0
  }));
  let neutralRed = 0;
  let neutralGreen = 0;
  let neutralBlue = 0;
  let neutralWeight = 0;
  let sampled = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const alpha = Number(data[offset + 3] ?? 0) / 255;
    if (alpha < 0.35) continue;
    const rgb: Rgb = [
      Number(data[offset] ?? 0),
      Number(data[offset + 1] ?? 0),
      Number(data[offset + 2] ?? 0)
    ];
    const [hue, saturation, lightness] = rgbToHsl(rgb);
    if (lightness < 5 || lightness > 97) continue;

    sampled += 1;
    const neutralPixelWeight =
      alpha * (1 - Math.min(0.82, saturation / 120));
    neutralRed += rgb[0] * neutralPixelWeight;
    neutralGreen += rgb[1] * neutralPixelWeight;
    neutralBlue += rgb[2] * neutralPixelWeight;
    neutralWeight += neutralPixelWeight;

    if (saturation < 18 || lightness < 12 || lightness > 90) continue;
    const bucket = hueBuckets[Math.floor(hue / 15) % hueBuckets.length]!;
    const chromaWeight =
      alpha *
      (0.45 + Math.min(saturation, 85) / 100) *
      (1 - Math.abs(lightness - 52) / 80);
    bucket.red += rgb[0] * chromaWeight;
    bucket.green += rgb[1] * chromaWeight;
    bucket.blue += rgb[2] * chromaWeight;
    bucket.weight += chromaWeight;
  }

  if (sampled === 0) {
    throw new Error("Image does not contain enough visible color data");
  }

  const ranked = hueBuckets
    .map((bucket, index) => ({ ...bucket, index }))
    .filter((bucket) => bucket.weight > 0)
    .sort((left, right) => right.weight - left.weight);
  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    if (
      selected.every(
        (current) =>
          circularBucketDistance(current.index, candidate.index, 24) >= 3
      )
    ) {
      selected.push(candidate);
    }
    if (selected.length === 3) break;
  }

  const fallbackRgb: Rgb =
    neutralWeight > 0
      ? [
          neutralRed / neutralWeight,
          neutralGreen / neutralWeight,
          neutralBlue / neutralWeight
        ]
      : [79, 93, 140];
  const fallbackHsl = rgbToHsl(fallbackRgb);
  const primary = extractedAccent(selected[0], [
    fallbackHsl[0],
    Math.max(fallbackHsl[1], 42),
    fallbackHsl[2]
  ]);
  const primaryHsl = rgbToHsl(hexToRgb(primary));
  const secondary = extractedAccent(selected[1], [
    (primaryHsl[0] + 42) % 360,
    Math.max(34, primaryHsl[1] * 0.78),
    primaryHsl[2] + 4
  ]);
  const tertiary = extractedAccent(selected[2], [
    (primaryHsl[0] + 128) % 360,
    Math.max(30, primaryHsl[1] * 0.72),
    primaryHsl[2] + 2
  ]);
  const [neutralHue, neutralSaturation, neutralLightness] =
    rgbToHsl(fallbackRgb);
  const neutral = rgbToHex(
    hslToRgb([
      neutralHue,
      Math.min(neutralSaturation, 12),
      clamp(neutralLightness, 34, 66)
    ])
  );

  return { primary, secondary, tertiary, neutral };
}

export function normalizeMaterialThemeSettings(
  value: Partial<MaterialThemeSettings> | null | undefined
): MaterialThemeSettings {
  const fallback = defaultMaterialThemeSettings;
  const candidateColors = value?.colors as Partial<ThemeSeedColors> | undefined;
  const colors: ThemeSeedColors = {
    primary: normalizeHex(candidateColors?.primary, fallback.colors.primary),
    secondary: normalizeHex(
      candidateColors?.secondary,
      fallback.colors.secondary
    ),
    tertiary: normalizeHex(candidateColors?.tertiary, fallback.colors.tertiary),
    neutral: normalizeHex(candidateColors?.neutral, fallback.colors.neutral)
  };
  const matchingPreset = themeColorPresets.find((preset) =>
    themeColorRoles.every(
      (role) => preset.colors[role].toUpperCase() === colors[role]
    )
  );
  const requestedPreset =
    typeof value?.presetId === "string"
      ? getThemeColorPreset(value.presetId)
      : null;

  return {
    enabled:
      typeof value?.enabled === "boolean" ? value.enabled : fallback.enabled,
    colors,
    presetId:
      requestedPreset &&
      themeColorRoles.every(
        (role) => requestedPreset.colors[role].toUpperCase() === colors[role]
      )
        ? requestedPreset.id
        : matchingPreset?.id ?? null
  };
}

export function readMaterialThemeSettings(
  storage: Pick<Storage, "getItem"> | null = browserStorage()
): MaterialThemeSettings {
  if (!storage) return cloneDefaultSettings();
  try {
    const raw = storage.getItem(materialThemeSettingsStorageKey);
    if (!raw) return cloneDefaultSettings();
    const parsed = JSON.parse(raw) as Partial<MaterialThemeSettings> & {
      version?: number;
    };
    if (parsed.version !== materialThemeSettingsStorageVersion) {
      return cloneDefaultSettings();
    }
    return normalizeMaterialThemeSettings(parsed);
  } catch {
    return cloneDefaultSettings();
  }
}

export function persistMaterialThemeSettings(
  settings: MaterialThemeSettings,
  storage: Pick<Storage, "setItem"> | null = browserStorage()
): MaterialThemeSettings {
  const normalized = normalizeMaterialThemeSettings(settings);
  try {
    storage?.setItem(
      materialThemeSettingsStorageKey,
      JSON.stringify({
        version: materialThemeSettingsStorageVersion,
        ...normalized
      })
    );
  } catch {
    // Applying still works when persistent browser storage is blocked.
  }
  return normalized;
}

export function createMaterialThemeTokens(
  settings: MaterialThemeSettings,
  colorScheme: MaterialColorScheme
): Record<string, string> {
  const { primary, secondary, tertiary, neutral } =
    normalizeMaterialThemeSettings(settings).colors;
  const dark = colorScheme === "dark";
  const tokens: Record<string, string> = {};

  assignAccentTokens(tokens, "primary", primary, dark, true);
  assignAccentTokens(tokens, "secondary", secondary, dark);
  assignAccentTokens(tokens, "tertiary", tertiary, dark);
  assignErrorTokens(tokens, dark);

  const neutralTone = (lightness: number) =>
    tone(neutral, lightness, 0.34, 14);
  const surface = neutralTone(dark ? 6 : 98);
  tokens["--md-sys-color-background"] = surface;
  tokens["--md-sys-color-on-background"] = neutralTone(dark ? 90 : 10);
  tokens["--md-sys-color-surface"] = surface;
  tokens["--md-sys-color-on-surface"] = neutralTone(dark ? 90 : 10);
  tokens["--md-sys-color-surface-variant"] = neutralTone(dark ? 30 : 90);
  tokens["--md-sys-color-on-surface-variant"] = neutralTone(dark ? 80 : 30);
  tokens["--md-sys-color-surface-dim"] = neutralTone(dark ? 6 : 87);
  tokens["--md-sys-color-surface-bright"] = neutralTone(dark ? 24 : 98);
  tokens["--md-sys-color-surface-container-lowest"] = neutralTone(
    dark ? 4 : 100
  );
  tokens["--md-sys-color-surface-container-low"] = neutralTone(
    dark ? 10 : 96
  );
  tokens["--md-sys-color-surface-container"] = neutralTone(dark ? 12 : 94);
  tokens["--md-sys-color-surface-container-high"] = neutralTone(
    dark ? 17 : 92
  );
  tokens["--md-sys-color-surface-container-highest"] = neutralTone(
    dark ? 22 : 90
  );
  tokens["--md-sys-color-surface-tint"] = requiredToken(
    tokens,
    "--md-sys-color-primary"
  );
  tokens["--md-sys-color-outline"] = neutralTone(dark ? 60 : 50);
  tokens["--md-sys-color-outline-variant"] = neutralTone(dark ? 30 : 80);
  tokens["--md-sys-color-shadow"] = "#000000";
  tokens["--md-sys-color-scrim"] = "#000000";
  tokens["--md-sys-color-inverse-surface"] = neutralTone(dark ? 90 : 20);
  tokens["--md-sys-color-inverse-on-surface"] = neutralTone(dark ? 20 : 95);

  Object.assign(tokens, {
    "--md-sys-shape-corner-none": "0px",
    "--md-sys-shape-corner-extra-small": "4px",
    "--md-sys-shape-corner-small": "8px",
    "--md-sys-shape-corner-medium": "12px",
    "--md-sys-shape-corner-large": "16px",
    "--md-sys-shape-corner-extra-large": "28px",
    "--md-sys-shape-corner-full": "999px",
    "--md-sys-state-hover-state-layer-opacity": "0.08",
    "--md-sys-state-focus-state-layer-opacity": "0.10",
    "--md-sys-state-pressed-state-layer-opacity": "0.10",
    "--md-sys-state-dragged-state-layer-opacity": "0.16"
  });

  return tokens;
}

/**
 * Bridges the MD3 token set to the project's established variables. Theme
 * packages continue to provide typography, radii, assets, and CSS; these
 * aliases only override colors while the custom palette is enabled.
 */
export function createLegacyThemeTokenMap(
  materialTokens: Readonly<Record<string, string>>
): Record<string, string> {
  const token = (name: string) => requiredToken(materialTokens, name);
  return {
    "--bg": token("--md-sys-color-background"),
    "--bg-raised": token("--md-sys-color-surface-container-lowest"),
    "--panel": token("--md-sys-color-surface-container-low"),
    "--panel-2": token("--md-sys-color-surface-container"),
    "--panel-3": token("--md-sys-color-surface-container-high"),
    "--line": token("--md-sys-color-outline-variant"),
    "--line-soft": withAlpha(token("--md-sys-color-outline-variant"), 0.58),
    "--text": token("--md-sys-color-on-surface"),
    "--text-soft": token("--md-sys-color-on-surface-variant"),
    "--text-dim": token("--md-sys-color-outline"),
    "--lime": token("--md-sys-color-primary"),
    "--lime-ink": token("--md-sys-color-on-primary"),
    "--teal": token("--md-sys-color-tertiary"),
    "--violet": token("--md-sys-color-secondary"),
    "--amber": "#A66300",
    "--red": token("--md-sys-color-error"),
    "--blue": token("--md-sys-color-primary")
  };
}

export function applyMaterialThemeSettingsToRoot(
  root: HTMLElement,
  settings: MaterialThemeSettings,
  colorScheme: MaterialColorScheme
): Record<string, string> | null {
  const normalized = normalizeMaterialThemeSettings(settings);
  if (!normalized.enabled) {
    clearMaterialColorOverrides(root);
    return null;
  }
  clearMaterialColorOverrides(root);

  const materialTokens = createMaterialThemeTokens(normalized, colorScheme);
  const legacyTokens = createLegacyThemeTokenMap(materialTokens);
  const materialColorTokens = Object.fromEntries(
    [...materialColorTokenNames, ...materialStateTokenNames]
      .map((name) => [name, materialTokens[name]])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
  for (const [name, value] of Object.entries({
    ...materialColorTokens,
    ...legacyTokens
  })) {
    root.style.setProperty(name, value);
  }
  root.dataset.materialTheme = "custom";
  if (normalized.presetId) {
    root.dataset.materialPreset = normalized.presetId;
  }
  return materialTokens;
}

export function clearMaterialThemeTokens(root: HTMLElement): void {
  clearMaterialSystemTokens(root);
  for (const token of legacyMaterialThemeTokenNames) {
    root.style.removeProperty(token);
  }
}

function clearMaterialSystemTokens(root: HTMLElement): void {
  delete root.dataset.materialTheme;
  delete root.dataset.materialPreset;
  for (const token of materialThemeTokenNames) {
    root.style.removeProperty(token);
  }
}

function clearMaterialColorOverrides(root: HTMLElement): void {
  delete root.dataset.materialTheme;
  delete root.dataset.materialPreset;
  for (const token of [...materialColorTokenNames, ...materialStateTokenNames]) {
    root.style.removeProperty(token);
  }
  for (const token of legacyMaterialThemeTokenNames) {
    root.style.removeProperty(token);
  }
}

function assignAccentTokens(
  tokens: Record<string, string>,
  role: "primary" | "secondary" | "tertiary",
  seed: string,
  dark: boolean,
  includeInverse = false
): void {
  const prefix = `--md-sys-color-${role}`;
  tokens[prefix] = tone(seed, dark ? 80 : 40);
  tokens[`--md-sys-color-on-${role}`] = tone(seed, dark ? 20 : 100);
  tokens[`${prefix}-container`] = tone(seed, dark ? 30 : 90);
  tokens[`--md-sys-color-on-${role}-container`] = tone(
    seed,
    dark ? 90 : 10
  );
  tokens[`${prefix}-fixed`] = tone(seed, 90);
  tokens[`${prefix}-fixed-dim`] = tone(seed, 80);
  tokens[`--md-sys-color-on-${role}-fixed`] = tone(seed, 10);
  tokens[`--md-sys-color-on-${role}-fixed-variant`] = tone(seed, 30);
  if (includeInverse) {
    tokens["--md-sys-color-inverse-primary"] = tone(seed, dark ? 40 : 80);
  }
}

function assignErrorTokens(
  tokens: Record<string, string>,
  dark: boolean
): void {
  const errorSeed = "#B3261E";
  tokens["--md-sys-color-error"] = tone(errorSeed, dark ? 80 : 40);
  tokens["--md-sys-color-on-error"] = tone(errorSeed, dark ? 20 : 100);
  tokens["--md-sys-color-error-container"] = tone(
    errorSeed,
    dark ? 30 : 90
  );
  tokens["--md-sys-color-on-error-container"] = tone(
    errorSeed,
    dark ? 90 : 10
  );
}

function tone(
  value: string,
  lightness: number,
  saturationScale = 1,
  saturationCap = 100
): string {
  const [hue, saturation] = rgbToHsl(hexToRgb(value));
  return rgbToHex(
    hslToRgb([
      hue,
      Math.min(saturation * saturationScale, saturationCap),
      lightness
    ])
  );
}

function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback.toUpperCase();
  const trimmed = value.trim();
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(trimmed);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  }
  return /^#[\da-f]{6}$/i.test(trimmed)
    ? trimmed.toUpperCase()
    : fallback.toUpperCase();
}

function cloneDefaultSettings(): MaterialThemeSettings {
  return {
    ...defaultMaterialThemeSettings,
    colors: { ...defaultMaterialThemeSettings.colors }
  };
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function hexToRgb(value: string): Rgb {
  const normalized = normalizeHex(value, "#000000");
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16)
  ];
}

function rgbToHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(channel).toString(16).padStart(2, "0").toUpperCase()
    )
    .join("")}`;
}

function rgbToHsl([redByte, greenByte, blueByte]: Rgb): Hsl {
  const red = redByte / 255;
  const green = greenByte / 255;
  const blue = blueByte / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [hue, saturation * 100, lightness * 100];
}

function hslToRgb([hue, saturationPercent, lightnessPercent]: Hsl): Rgb {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const intermediate = chroma * (1 - Math.abs((segment % 2) - 1));
  let [red, green, blue]: Rgb = [0, 0, 0];

  if (segment < 1) [red, green] = [chroma, intermediate];
  else if (segment < 2) [red, green] = [intermediate, chroma];
  else if (segment < 3) [green, blue] = [chroma, intermediate];
  else if (segment < 4) [green, blue] = [intermediate, chroma];
  else if (segment < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];

  const match = lightness - chroma / 2;
  return [
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255
  ];
}

function extractedAccent(
  bucket:
    | {
        red: number;
        green: number;
        blue: number;
        weight: number;
      }
    | undefined,
  fallback: Hsl
): string {
  const source =
    bucket && bucket.weight > 0
      ? rgbToHsl([
          bucket.red / bucket.weight,
          bucket.green / bucket.weight,
          bucket.blue / bucket.weight
        ])
      : fallback;
  return rgbToHex(
    hslToRgb([
      ((source[0] % 360) + 360) % 360,
      clamp(source[1], 32, 72),
      clamp(source[2], 34, 62)
    ])
  );
}

function circularBucketDistance(
  left: number,
  right: number,
  bucketCount: number
): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, bucketCount - direct);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function withAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${normalizeHex(hex, "#000000")}${alpha}`;
}

function requiredToken(
  tokens: Readonly<Record<string, string>>,
  name: string
): string {
  const value = tokens[name];
  if (!value) throw new Error(`Missing Material theme token: ${name}`);
  return value;
}
