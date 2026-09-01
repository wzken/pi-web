import { z } from "zod";
import { themeTokenNames } from "./theme-tokens.js";

const themeTokensSchema = z
  .record(z.string(), z.string().trim().min(1).max(300))
  .superRefine((tokens, context) => {
    const allowed = new Set<string>(themeTokenNames);
    for (const key of Object.keys(tokens)) {
      if (!allowed.has(key)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `Unsupported theme token: ${key}`
        });
      }
    }
  });

export const themeBackgroundSchema = z.object({
  image: z.string().trim().min(1).max(500),
  fit: z.enum(["cover", "contain", "tile"]).default("cover"),
  position: z.string().trim().min(1).max(120).default("center"),
  overlay: z.number().min(0).max(0.9).default(0.18),
  blur: z.number().min(0).max(24).default(0)
});
export type ThemeBackground = z.infer<typeof themeBackgroundSchema>;

const themeManifestMetadata = {
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(40),
  description: z.string().trim().max(240).default(""),
  author: z.string().trim().max(100).default(""),
  css: z.string().trim().min(1).max(500).optional(),
  preview: z.string().trim().min(1).max(500).optional(),
  background: themeBackgroundSchema.optional()
};

const singleSchemeThemeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  ...themeManifestMetadata,
  colorScheme: z.enum(["light", "dark"]).default("light"),
  tokens: themeTokensSchema.default({})
});

const dualSchemeThemeManifestSchema = z.object({
  schemaVersion: z.literal(2),
  ...themeManifestMetadata,
  schemes: z.object({
    light: z.object({ tokens: themeTokensSchema.default({}) }),
    dark: z.object({ tokens: themeTokensSchema.default({}) })
  })
});

export const themeManifestSchema = z.discriminatedUnion("schemaVersion", [
  singleSchemeThemeManifestSchema,
  dualSchemeThemeManifestSchema
]);
export type ThemeManifest = z.infer<typeof themeManifestSchema>;

export const defaultThemeMaterialSettings = {
  enabled: false,
  colors: {
    primary: "#54545B",
    secondary: "#69656C",
    tertiary: "#5D6765",
    neutral: "#77777A"
  },
  presetId: "graphite"
} as const;

const themeSeedColorSchema = z
  .string()
  .trim()
  .regex(/^#[\da-f]{6}$/i)
  .transform((value) => value.toUpperCase());

export const themeMaterialSettingsSchema = z
  .object({
    enabled: z.boolean().default(defaultThemeMaterialSettings.enabled),
    colors: z
      .object({
        primary: themeSeedColorSchema,
        secondary: themeSeedColorSchema,
        tertiary: themeSeedColorSchema,
        neutral: themeSeedColorSchema
      })
      .default({ ...defaultThemeMaterialSettings.colors }),
    presetId: z.string().trim().min(1).max(64).nullable().default(
      defaultThemeMaterialSettings.presetId
    )
  })
  .default({
    enabled: defaultThemeMaterialSettings.enabled,
    colors: { ...defaultThemeMaterialSettings.colors },
    presetId: defaultThemeMaterialSettings.presetId
  });
export type ThemeMaterialSettings = z.infer<typeof themeMaterialSettingsSchema>;

export const themePreferencesSchema = z.object({
  themeId: z.string().trim().min(1).max(64),
  colorMode: z.enum(["system", "light", "dark"]).default("system"),
  background: z
    .object({
      kind: z.enum(["none", "theme", "upload", "url"]).default("none"),
      url: z.string().trim().max(2048).default(""),
      fit: z.enum(["cover", "contain", "tile"]).default("cover"),
      position: z.string().trim().min(1).max(120).default("center"),
      overlay: z.number().min(0).max(0.9).default(0.18),
      blur: z.number().min(0).max(24).default(0),
      surfaceOpacity: z.number().min(0).max(0.95).default(0.22),
      panelOpacity: z.number().min(0).max(0.95).default(0.58),
      toolbarOpacity: z.number().min(0).max(0.95).default(0.48),
      interfaceBlur: z.number().min(0).max(24).default(8)
    })
    .default({
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
    }),
  // Kept with the server-owned appearance document so all operator browsers
  // resolve the same four MD3 seed roles. Older appearance files omit it and
  // receive the neutral default through the schema above.
  materialTheme: themeMaterialSettingsSchema
});
export type ThemePreferences = z.infer<typeof themePreferencesSchema>;

export type InstalledTheme = ThemeManifest & {
  source: "built-in" | "uploaded";
  cssUrl?: string;
  previewUrl?: string;
  backgroundUrl?: string;
  updatedAt: string;
};

export interface ThemeCatalog {
  themes: InstalledTheme[];
  preferences: ThemePreferences;
  userBackgroundUrl?: string;
}
