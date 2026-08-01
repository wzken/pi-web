import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, extname, join, posix } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  themeManifestSchema,
  themePreferencesSchema,
  defaultThemeMaterialSettings,
  type InstalledTheme,
  type ThemeCatalog,
  type ThemeManifest,
  type ThemePreferences
} from "@pi-web/protocol";
import { PiWebError, resolveContainedPath } from "@pi-web/shared";
import type { PiWebPaths } from "@pi-web/config";
import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;
const MAX_THEME_FILES = 240;
const BUILTIN_UPDATED_AT = "2026-08-01T00:00:00.000Z";
const RETIRED_THEME_IDS = new Set(["agegr-light", "agegr-dark"]);
const ARCHIVE_EXTENSIONS = new Set([
  ".json",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf"
]);

const defaultPreferences: ThemePreferences = {
  themeId: "pi-neutral",
  colorMode: "system",
  background: {
    kind: "none",
    url: "",
    fit: "cover",
    position: "center",
    overlay: 0.18,
    blur: 0
  },
  materialTheme: {
    enabled: defaultThemeMaterialSettings.enabled,
    colors: { ...defaultThemeMaterialSettings.colors },
    presetId: defaultThemeMaterialSettings.presetId
  }
};

const builtinThemes: InstalledTheme[] = [
  {
    schemaVersion: 2,
    id: "pi-neutral",
    name: "Pi Neutral",
    version: "2.0.1",
    description: "Pi Web 的中性默认工作台，仅用语义色表达状态。",
    author: "Pi Web",
    schemes: {
      light: {
        tokens: {
          "--bg": "#f7f7f8",
          "--bg-raised": "#ffffff",
          "--panel": "#ffffff",
          "--panel-2": "#f0f0f2",
          "--panel-3": "#e8e8eb",
          "--line": "#d6d6da",
          "--line-soft": "#e5e5e8",
          "--text": "#19191b",
          "--text-soft": "#5f5f66",
          "--text-dim": "#85858c",
          "--lime": "#2f3136",
          "--lime-ink": "#ffffff",
          "--teal": "#555861",
          "--violet": "#6b6872",
          "--amber": "#94651c",
          "--red": "#b54848",
          "--blue": "#456f9e",
          "--shadow": "0 18px 48px rgb(20 20 24 / 9%)",
          "--radius": "12px",
          "--radius-sm": "8px",
          "--font-ui": "Inter, ui-sans-serif, system-ui, sans-serif",
          "--font-mono": "\"SFMono-Regular\", Consolas, monospace"
        }
      },
      dark: {
        tokens: {
          "--bg": "#0b0b0c",
          "--bg-raised": "#0f0f10",
          "--panel": "#141415",
          "--panel-2": "#1a1a1c",
          "--panel-3": "#222225",
          "--line": "#343438",
          "--line-soft": "#252528",
          "--text": "#f5f5f6",
          "--text-soft": "#b2b2b7",
          "--text-dim": "#7e7e85",
          "--lime": "#e3e3e5",
          "--lime-ink": "#151516",
          "--teal": "#b7bbc3",
          "--violet": "#c0bdc7",
          "--amber": "#d2a15d",
          "--red": "#df7777",
          "--blue": "#83a3c9",
          "--shadow": "0 22px 60px rgb(0 0 0 / 42%)",
          "--radius": "12px",
          "--radius-sm": "8px",
          "--font-ui": "Inter, ui-sans-serif, system-ui, sans-serif",
          "--font-mono": "\"SFMono-Regular\", Consolas, monospace"
        }
      }
    },
    source: "built-in",
    updatedAt: BUILTIN_UPDATED_AT
  }
];

export function registerThemeRoutes(
  app: FastifyInstance,
  paths: PiWebPaths
): void {
  const service = new ThemeService(paths);

  app.addContentTypeParser(
    /^application\/(?:zip|x-zip-compressed)$/i,
    { parseAs: "buffer", bodyLimit: MAX_ARCHIVE_BYTES },
    (_request, body, done) => done(null, body)
  );
  app.addContentTypeParser(
    /^image\/(?:png|jpeg|webp|gif|avif)$/i,
    { parseAs: "buffer", bodyLimit: MAX_ARCHIVE_BYTES },
    (_request, body, done) => done(null, body)
  );
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_ARCHIVE_BYTES },
    (_request, body, done) => done(null, body)
  );

  app.get("/api/themes", async () => await service.catalog());

  app.put<{ Body: unknown }>("/api/themes/preferences", async (request) =>
    await service.updatePreferences(request.body)
  );

  app.post<{ Body: Buffer }>(
    "/api/themes/install",
    { bodyLimit: MAX_ARCHIVE_BYTES },
    async (request) => {
      if (!Buffer.isBuffer(request.body)) {
        throw new PiWebError(
          "THEME_ARCHIVE_REQUIRED",
          "Upload a ZIP theme package",
          415
        );
      }
      return await service.install(request.body);
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/themes/:id",
    async (request) => await service.remove(request.params.id)
  );

  app.post<{ Body: Buffer }>(
    "/api/themes/background",
    { bodyLimit: MAX_ARCHIVE_BYTES },
    async (request) => {
      if (!Buffer.isBuffer(request.body)) {
        throw new PiWebError(
          "BACKGROUND_IMAGE_REQUIRED",
          "Upload a PNG, JPEG, WebP, GIF, or AVIF image",
          415
        );
      }
      return await service.uploadBackground(
        request.body,
        request.headers["content-type"] ?? ""
      );
    }
  );

  app.delete("/api/themes/background", async () =>
    await service.removeBackground()
  );

  app.get<{
    Params: { themeId: string; "*": string };
  }>("/api/theme-assets/:themeId/*", async (request, reply) => {
    const asset = await service.resolveAsset(
      request.params.themeId,
      request.params["*"]
    );
    reply.header("Cache-Control", "private, max-age=3600");
    reply.type(asset.contentType);
    return reply.send(createReadStream(asset.path));
  });
}

export class ThemeService {
  private readonly themeRoot: string;
  private readonly packageRoot: string;
  private readonly backgroundRoot: string;
  private readonly preferencesFile: string;

  constructor(private readonly paths: PiWebPaths) {
    this.themeRoot = join(paths.dataDir, "themes");
    this.packageRoot = join(this.themeRoot, "packages");
    this.backgroundRoot = join(this.themeRoot, "background");
    this.preferencesFile = join(paths.configDir, "appearance.json");
  }

  async catalog(): Promise<ThemeCatalog> {
    await this.ensureDirectories();
    const themes = [...builtinThemes, ...(await this.readUploadedThemes())];
    const preferences = await this.readPreferences(themes);
    return {
      themes,
      preferences,
      ...(await this.backgroundUrl())
    };
  }

  async updatePreferences(input: unknown): Promise<ThemeCatalog> {
    const themes = [...builtinThemes, ...(await this.readUploadedThemes())];
    const current = await this.readPreferences(themes);
    const preferences = themePreferencesSchema.parse(
      isPreferenceObject(input) && !("materialTheme" in input)
        ? { ...input, materialTheme: current.materialTheme }
        : input
    );
    if (!themes.some((theme) => theme.id === preferences.themeId)) {
      throw new PiWebError("THEME_NOT_FOUND", "Selected theme is not installed", 404);
    }
    if (preferences.background.kind === "url") {
      assertRemoteImageUrl(preferences.background.url);
    }
    if (
      preferences.background.kind === "upload" &&
      !(await this.backgroundUrl()).userBackgroundUrl
    ) {
      throw new PiWebError(
        "BACKGROUND_NOT_FOUND",
        "Upload a background image before selecting it",
        400
      );
    }
    await this.writePreferences(preferences);
    return await this.catalog();
  }

  async install(archive: Buffer): Promise<ThemeCatalog> {
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw new PiWebError(
        "THEME_ARCHIVE_TOO_LARGE",
        "Theme ZIP is limited to 8 MB",
        413
      );
    }
    const files = readThemeArchive(archive);
    const manifestBytes = files.get("theme.json");
    if (!manifestBytes) {
      throw new PiWebError(
        "THEME_MANIFEST_MISSING",
        "Theme ZIP must contain theme.json at its root",
        400
      );
    }
    let manifest: ThemeManifest;
    try {
      manifest = themeManifestSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes))
      );
    } catch (error) {
      throw new PiWebError(
        "THEME_MANIFEST_INVALID",
        "theme.json is not a valid Pi Web theme manifest",
        400,
        error
      );
    }
    if (
      builtinThemes.some((theme) => theme.id === manifest.id) ||
      RETIRED_THEME_IDS.has(manifest.id)
    ) {
      throw new PiWebError(
        "THEME_ID_RESERVED",
        "This theme id is reserved by a built-in theme",
        409
      );
    }
    validateManifestAssets(manifest, files);
    if (manifest.css) {
      validateThemeCss(files.get(manifest.css)!);
    }

    await this.ensureDirectories();
    const temporary = join(
      this.packageRoot,
      `.install-${manifest.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const target = join(this.packageRoot, manifest.id);
    const backup = join(
      this.packageRoot,
      `.backup-${manifest.id}-${Date.now()}`
    );
    await mkdir(temporary, { recursive: true });
    try {
      for (const [relativePath, contents] of files) {
        const destination = join(temporary, ...relativePath.split("/"));
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents);
      }
      await writeFile(
        join(temporary, "theme.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );

      const targetExists = await stat(target).then(() => true).catch(() => false);
      if (targetExists) await rename(target, backup);
      try {
        await rename(temporary, target);
      } catch (error) {
        if (targetExists) await rename(backup, target).catch(() => undefined);
        throw error;
      }
      if (targetExists) await rm(backup, { recursive: true, force: true });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    return await this.catalog();
  }

  async remove(id: string): Promise<ThemeCatalog> {
    assertThemeId(id);
    if (builtinThemes.some((theme) => theme.id === id)) {
      throw new PiWebError(
        "BUILTIN_THEME",
        "Built-in themes cannot be deleted",
        400
      );
    }
    const target = join(this.packageRoot, id);
    const exists = await stat(target).then(() => true).catch(() => false);
    if (!exists) {
      throw new PiWebError("THEME_NOT_FOUND", "Theme is not installed", 404);
    }
    const current = await this.readPreferences([
      ...builtinThemes,
      ...(await this.readUploadedThemes())
    ]);
    await rm(target, { recursive: true, force: true });
    if (current.themeId === id) {
      await this.writePreferences(defaultPreferences);
    }
    return await this.catalog();
  }

  async uploadBackground(
    body: Buffer,
    claimedContentType: string
  ): Promise<ThemeCatalog> {
    if (body.byteLength === 0 || body.byteLength > MAX_ARCHIVE_BYTES) {
      throw new PiWebError(
        "BACKGROUND_TOO_LARGE",
        "Background image must be between 1 byte and 8 MB",
        413
      );
    }
    const image = sniffImage(body);
    if (
      claimedContentType &&
      !claimedContentType.toLowerCase().startsWith(image.contentType)
    ) {
      throw new PiWebError(
        "BACKGROUND_TYPE_MISMATCH",
        "The uploaded file contents do not match its image type",
        415
      );
    }
    await this.ensureDirectories();
    await this.clearBackgroundFiles();
    await writeFile(join(this.backgroundRoot, `background${image.extension}`), body);
    return await this.catalog();
  }

  async removeBackground(): Promise<ThemeCatalog> {
    await this.ensureDirectories();
    await this.clearBackgroundFiles();
    const catalog = await this.catalog();
    if (catalog.preferences.background.kind === "upload") {
      await this.writePreferences({
        ...catalog.preferences,
        background: {
          ...catalog.preferences.background,
          kind: "none"
        }
      });
    }
    return await this.catalog();
  }

  async resolveAsset(
    themeId: string,
    requestedPath: string
  ): Promise<{ path: string; contentType: string }> {
    assertThemeId(themeId === "_user" ? "user" : themeId);
    const root =
      themeId === "_user"
        ? this.backgroundRoot
        : join(this.packageRoot, themeId);
    const path = await resolveContainedPath(root, requestedPath);
    const info = await stat(path);
    if (!info.isFile()) {
      throw new PiWebError("THEME_ASSET_NOT_FOUND", "Theme asset not found", 404);
    }
    const contentType = assetContentType(path);
    if (!contentType) {
      throw new PiWebError(
        "THEME_ASSET_BLOCKED",
        "This theme asset type is not allowed",
        415
      );
    }
    return { path, contentType };
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.packageRoot, { recursive: true }),
      mkdir(this.backgroundRoot, { recursive: true }),
      mkdir(this.paths.configDir, { recursive: true })
    ]);
  }

  private async readUploadedThemes(): Promise<InstalledTheme[]> {
    await this.ensureDirectories();
    const entries = await readdir(this.packageRoot, { withFileTypes: true });
    const themes = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => {
          try {
            assertThemeId(entry.name);
            const directory = join(this.packageRoot, entry.name);
            const manifest = themeManifestSchema.parse(
              JSON.parse(await readFile(join(directory, "theme.json"), "utf8"))
            );
            if (
              manifest.id !== entry.name ||
              RETIRED_THEME_IDS.has(manifest.id)
            ) {
              return null;
            }
            if (manifest.css) {
              const cssPath = normalizeArchivePath(manifest.css);
              if (cssPath !== manifest.css) return null;
              validateThemeCss(
                await readFile(join(directory, ...cssPath.split("/")))
              );
            }
            const info = await stat(directory);
            const query = encodeURIComponent(info.mtimeMs.toString(36));
            return toInstalledTheme(manifest, query, info.mtime.toISOString());
          } catch {
            return null;
          }
        })
    );
    return themes
      .filter((theme): theme is InstalledTheme => theme !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private async readPreferences(
    themes: InstalledTheme[]
  ): Promise<ThemePreferences> {
    const parsed = await readFile(this.preferencesFile, "utf8")
      .then((contents) => themePreferencesSchema.safeParse(JSON.parse(contents)))
      .catch(() => null);
    const preferences = parsed?.success ? parsed.data : defaultPreferences;
    if (themes.some((theme) => theme.id === preferences.themeId)) {
      return preferences;
    }
    return {
      ...preferences,
      themeId: defaultPreferences.themeId,
      background:
        preferences.background.kind === "theme"
          ? { ...preferences.background, kind: "none" }
          : preferences.background
    };
  }

  private async writePreferences(preferences: ThemePreferences): Promise<void> {
    await this.ensureDirectories();
    const temporary = `${this.preferencesFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    await rm(this.preferencesFile, { force: true });
    await rename(temporary, this.preferencesFile);
  }

  private async clearBackgroundFiles(): Promise<void> {
    const entries = await readdir(this.backgroundRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith("background."))
        .map((entry) => rm(join(this.backgroundRoot, entry.name), { force: true }))
    );
  }

  private async backgroundUrl(): Promise<Pick<ThemeCatalog, "userBackgroundUrl">> {
    await this.ensureDirectories();
    const entries = await readdir(this.backgroundRoot, { withFileTypes: true });
    const background = entries.find(
      (entry) => entry.isFile() && entry.name.startsWith("background.")
    );
    return background
      ? {
          userBackgroundUrl: `/api/theme-assets/_user/${encodeURIComponent(
            background.name
          )}`
        }
      : {};
  }
}

function isPreferenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toInstalledTheme(
  manifest: ThemeManifest,
  cacheKey: string,
  updatedAt: string
): InstalledTheme {
  const assetUrl = (path: string) =>
    `/api/theme-assets/${encodeURIComponent(manifest.id)}/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?v=${cacheKey}`;
  return {
    ...manifest,
    source: "uploaded",
    updatedAt,
    ...(manifest.css ? { cssUrl: assetUrl(manifest.css) } : {}),
    ...(manifest.preview ? { previewUrl: assetUrl(manifest.preview) } : {}),
    ...(manifest.background
      ? { backgroundUrl: assetUrl(manifest.background.image) }
      : {})
  };
}

function readThemeArchive(archive: Buffer): Map<string, Uint8Array> {
  let expanded: Record<string, Uint8Array>;
  let declaredBytes = 0;
  let declaredFiles = 0;
  let rejectedForSize = false;
  try {
    expanded = unzipSync(new Uint8Array(archive), {
      filter(file) {
        declaredFiles += 1;
        declaredBytes += file.originalSize;
        if (
          declaredFiles > MAX_THEME_FILES ||
          declaredBytes > MAX_UNPACKED_BYTES
        ) {
          rejectedForSize = true;
          return false;
        }
        return true;
      }
    });
  } catch {
    throw new PiWebError(
      "THEME_ARCHIVE_INVALID",
      "The uploaded file is not a readable ZIP archive",
      400
    );
  }
  if (rejectedForSize) {
    throw new PiWebError(
      "THEME_ARCHIVE_EXPANDED_TOO_LARGE",
      `Theme ZIP exceeds ${MAX_THEME_FILES} files or 20 MB unpacked`,
      413
    );
  }
  const rawEntries = Object.entries(expanded).filter(
    ([name]) => !name.endsWith("/") && !name.startsWith("__MACOSX/")
  );
  if (rawEntries.length === 0 || rawEntries.length > MAX_THEME_FILES) {
    throw new PiWebError(
      "THEME_ARCHIVE_FILE_COUNT",
      `Theme ZIP must contain between 1 and ${MAX_THEME_FILES} files`,
      400
    );
  }
  const manifestPaths = rawEntries
    .map(([name]) => normalizeArchivePath(name))
    .filter((name) => basename(name) === "theme.json");
  if (manifestPaths.length !== 1) {
    throw new PiWebError(
      "THEME_MANIFEST_COUNT",
      "Theme ZIP must contain exactly one theme.json",
      400
    );
  }
  const prefix = dirname(manifestPaths[0]!).replaceAll("\\", "/");
  let totalBytes = 0;
  const files = new Map<string, Uint8Array>();
  for (const [rawName, contents] of rawEntries) {
    const normalized = normalizeArchivePath(rawName);
    const relativePath =
      prefix === "." || prefix === ""
        ? normalized
        : normalized.startsWith(`${prefix}/`)
          ? normalized.slice(prefix.length + 1)
          : "";
    if (!relativePath) continue;
    assertThemeAssetPath(relativePath);
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_UNPACKED_BYTES) {
      throw new PiWebError(
        "THEME_ARCHIVE_EXPANDED_TOO_LARGE",
        "Theme ZIP expands beyond the 20 MB limit",
        413
      );
    }
    if (files.has(relativePath)) {
      throw new PiWebError(
        "THEME_ARCHIVE_DUPLICATE",
        `Theme ZIP contains a duplicate path: ${relativePath}`,
        400
      );
    }
    files.set(relativePath, contents);
  }
  return files;
}

function normalizeArchivePath(input: string): string {
  const normalized = posix.normalize(input.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0") ||
    /^[a-z]:/i.test(normalized)
  ) {
    throw new PiWebError(
      "THEME_ARCHIVE_PATH",
      "Theme ZIP contains an unsafe path",
      400
    );
  }
  return normalized;
}

function assertThemeAssetPath(path: string): void {
  const extension = extname(path).toLowerCase();
  if (!ARCHIVE_EXTENSIONS.has(extension)) {
    throw new PiWebError(
      "THEME_ASSET_TYPE",
      `Theme asset type is not allowed: ${path}`,
      415
    );
  }
}

function validateManifestAssets(
  manifest: ThemeManifest,
  files: Map<string, Uint8Array>
): void {
  for (const path of [
    manifest.css,
    manifest.preview,
    manifest.background?.image
  ].filter((value): value is string => Boolean(value))) {
    const normalized = normalizeArchivePath(path);
    if (normalized !== path || !files.has(normalized)) {
      throw new PiWebError(
        "THEME_ASSET_MISSING",
        `Theme manifest references a missing asset: ${path}`,
        400
      );
    }
    assertThemeAssetPath(path);
  }
  if (manifest.css && extname(manifest.css).toLowerCase() !== ".css") {
    throw new PiWebError("THEME_CSS_TYPE", "Theme css must be a .css file", 400);
  }
}

function validateThemeCss(contents: Uint8Array): void {
  let css: string;
  try {
    css = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    throw new PiWebError("THEME_CSS_ENCODING", "Theme CSS must be UTF-8", 400);
  }
  if (/@import\b|javascript\s*:|expression\s*\(|-moz-binding/i.test(css)) {
    throw new PiWebError(
      "THEME_CSS_UNSAFE",
      "Theme CSS contains a blocked external or executable construct",
      400
    );
  }
  if (/--(?:sidebar|workspace-app-rail)\s*:/i.test(css)) {
    throw new PiWebError(
      "THEME_CSS_LAYOUT_TOKEN",
      "Theme CSS cannot override application-owned shell geometry",
      400
    );
  }
}

function assertThemeId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new PiWebError("THEME_ID_INVALID", "Invalid theme id", 400);
  }
}

function assertRemoteImageUrl(value: string): void {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
  } catch {
    throw new PiWebError(
      "BACKGROUND_URL_INVALID",
      "Background URL must use http:// or https://",
      400
    );
  }
}

function sniffImage(body: Buffer): {
  extension: string;
  contentType: string;
} {
  if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { extension: ".png", contentType: "image/png" };
  }
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    return { extension: ".jpg", contentType: "image/jpeg" };
  }
  if (
    body.length >= 12 &&
    body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: ".webp", contentType: "image/webp" };
  }
  if (
    body.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(body.toString("ascii", 0, 6))
  ) {
    return { extension: ".gif", contentType: "image/gif" };
  }
  if (
    body.length >= 12 &&
    body.toString("ascii", 4, 8) === "ftyp" &&
    body.toString("ascii", 8, 12).includes("avif")
  ) {
    return { extension: ".avif", contentType: "image/avif" };
  }
  throw new PiWebError(
    "BACKGROUND_IMAGE_INVALID",
    "Background must be a PNG, JPEG, WebP, GIF, or AVIF image",
    415
  );
}

function assetContentType(path: string): string | null {
  const extension = extname(path).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf"
    }[extension] ?? null
  );
}
