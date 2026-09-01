import { basename, dirname, extname, posix } from "node:path";
import { unzipSync } from "fflate";
import type { InstalledTheme, ThemeManifest } from "@pi-web/protocol";
import { PiWebError } from "@pi-web/shared";

const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;
const MAX_THEME_FILES = 240;
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

export function isPreferenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toInstalledTheme(
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

export function readThemeArchive(archive: Buffer): Map<string, Uint8Array> {
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

export function normalizeArchivePath(input: string): string {
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

export function validateManifestAssets(
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

export function validateThemeCss(contents: Uint8Array): void {
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

export function assertThemeId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new PiWebError("THEME_ID_INVALID", "Invalid theme id", 400);
  }
}

export function assertRemoteImageUrl(value: string): void {
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

export function sniffImage(body: Buffer): {
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

export function assetContentType(path: string): string | null {
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
