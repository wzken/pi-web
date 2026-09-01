import type { ThemePreferences } from "@pi-web/protocol";
import type { MaterialThemeSettings } from "../../theme";
import { extractThemeSeedColors } from "../../theme-customization";
import { t } from "../../i18n";

type BackgroundSettings = ThemePreferences["background"];
const maximumBackgroundBytes = 8 * 1024 * 1024;
export const acceptedBackgroundTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

export function validateBackgroundFile(file: File): void {
  if (!acceptedBackgroundTypes.has(file.type)) {
    throw new Error(t("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。"));
  }
  if (file.size <= 0 || file.size > maximumBackgroundBytes) {
    throw new Error(t("背景图片必须小于 8 MB。"));
  }
}

export function isRemoteBackgroundUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function assertBackgroundReady(
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

export function resolveBackgroundPreviewUrl(
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

export function backgroundExtractionSource(
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

export async function extractColorsFromImage(
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
