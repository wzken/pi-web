import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
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
import {
  assetContentType,
  assertRemoteImageUrl,
  assertThemeId,
  isPreferenceObject,
  normalizeArchivePath,
  readThemeArchive,
  sniffImage,
  toInstalledTheme,
  validateManifestAssets,
  validateThemeCss
} from "./theme-package.js";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const BUILTIN_UPDATED_AT = "2026-08-12T00:00:00.000Z";
const RETIRED_THEME_IDS = new Set(["agegr-light", "agegr-dark"]);
const defaultPreferences: ThemePreferences = {
  themeId: "pi-neutral",
  colorMode: "system",
  background: {
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
    version: "2.1.0",
    description: "Pi Web 的自适应监督工作台，以自然绿和青色表达操作、连接与状态。",
    author: "Pi Web",
    schemes: {
      light: {
        tokens: {
          "--bg": "#f3f5f0",
          "--bg-raised": "#fafbf8",
          "--panel": "#ffffff",
          "--panel-2": "#eef2ec",
          "--panel-3": "#e4ebe2",
          "--line": "#c8d2c8",
          "--line-soft": "#dce3dc",
          "--text": "#17201d",
          "--text-soft": "#4f5e58",
          "--text-dim": "#74817c",
          "--lime": "#357a22",
          "--lime-ink": "#ffffff",
          "--teal": "#087c72",
          "--violet": "#6555b8",
          "--amber": "#9a6213",
          "--red": "#b43d39",
          "--blue": "#286cad",
          "--shadow": "0 24px 70px rgb(31 52 43 / 14%)",
          "--radius": "18px",
          "--radius-sm": "12px",
          "--font-ui": "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif",
          "--font-mono": "Cascadia Code, SFMono-Regular, Consolas, monospace"
        }
      },
      dark: {
        tokens: {
          "--bg": "#0c1110",
          "--bg-raised": "#101716",
          "--panel": "#141c1a",
          "--panel-2": "#182321",
          "--panel-3": "#20302c",
          "--line": "#31413d",
          "--line-soft": "#24332f",
          "--text": "#f2f6f3",
          "--text-soft": "#b7c3bf",
          "--text-dim": "#7f918b",
          "--lime": "#a8ea7b",
          "--lime-ink": "#10200b",
          "--teal": "#66d7c2",
          "--violet": "#b6a8ff",
          "--amber": "#f2bb63",
          "--red": "#ff817c",
          "--blue": "#80b8ff",
          "--shadow": "0 24px 70px rgb(0 0 0 / 34%)",
          "--radius": "18px",
          "--radius-sm": "12px",
          "--font-ui": "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif",
          "--font-mono": "Cascadia Code, SFMono-Regular, Consolas, monospace"
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
    const temporary = `${this.preferencesFile}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.preferencesFile);
    } finally {
      await rm(temporary, { force: true });
    }
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
