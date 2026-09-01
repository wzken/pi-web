import {
  Check,
  Image as ImageIcon,
  Link2,
  Palette,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import type { RefObject, ReactNode } from "react";
import type { ThemePreferences } from "@pi-web/protocol";
import { Button, ErrorBanner } from "../../components";
import { t } from "../../i18n";
import { ui } from "../../ui";
import styles from "../../pages/SettingsPage.module.css";
import {
  acceptedBackgroundTypes,
  isRemoteBackgroundUrl
} from "./theme-image-colors";

type BackgroundSettings = ThemePreferences["background"];
export type BackgroundBusyState = "upload" | "remove" | "extract" | null;

export function ThemeBackgroundEditor({
  value,
  busy,
  error,
  safeMode,
  previewUrl,
  supportsThemeBackground,
  uploadedUrl,
  uploadInputRef,
  onDismissError,
  onChange,
  onUpload,
  onRemove,
  onExtract
}: {
  value: BackgroundSettings;
  busy: BackgroundBusyState;
  error: unknown;
  safeMode: boolean;
  previewUrl: string | null;
  supportsThemeBackground: boolean;
  uploadedUrl: string | undefined;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onDismissError: () => void;
  onChange: (value: Partial<BackgroundSettings>) => void;
  onUpload: (file: File | undefined) => Promise<void>;
  onRemove: () => Promise<void>;
  onExtract: () => Promise<void>;
}) {
  return (
      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("背景图片")}</h3>
          <p>{t("使用本地图片或图片链接，并实时预览裁切与遮罩。")}</p>
        </div>

        <div
          className={styles.backgroundSourceGrid}
          role="radiogroup"
          aria-label={t("背景来源")}
        >
          <BackgroundChoice
            label={t("无背景")}
            checked={value.kind === "none"}
            icon={<ImageIcon size={18} />}
            disabled={safeMode}
            onSelect={() => onChange({ kind: "none" })}
          />
          <BackgroundChoice
            label={t("本地图片")}
            checked={value.kind === "upload"}
            icon={<Upload size={18} />}
            disabled={safeMode}
            onSelect={() => {
              if (uploadedUrl) {
                onChange({ kind: "upload", url: "" });
              } else {
                uploadInputRef.current?.click();
              }
            }}
          />
          <BackgroundChoice
            label={t("图片链接")}
            checked={value.kind === "url"}
            icon={<Link2 size={18} />}
            disabled={safeMode}
            onSelect={() => onChange({ kind: "url" })}
          />
          {supportsThemeBackground && (
            <BackgroundChoice
              label={t("主题自带")}
              checked={value.kind === "theme"}
              icon={<Palette size={18} />}
              disabled={safeMode}
              onSelect={() => onChange({ kind: "theme", url: "" })}
            />
          )}
        </div>

        <input
          ref={uploadInputRef}
          className={styles.hiddenFileInput}
          type="file"
          accept={[...acceptedBackgroundTypes].join(",")}
          tabIndex={-1}
          aria-hidden="true"
          disabled={safeMode || busy !== null}
          onChange={(event) =>
            void onUpload(event.currentTarget.files?.[0])
          }
        />

        {value.kind === "upload" && (
          <div className={styles.backgroundSourcePanel}>
            <div>
              <strong>
                {uploadedUrl
                  ? t("已上传背景图片")
                  : t("尚未上传图片")}
              </strong>
              <span>{t("支持 PNG、JPEG、WebP、GIF、AVIF，最大 8 MB。")}</span>
            </div>
            <div className={styles.backgroundSourceActions}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === "upload"}
                disabled={safeMode || busy !== null}
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload size={15} />
                {uploadedUrl ? t("替换图片") : t("选择图片")}
              </Button>
              {uploadedUrl && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={busy === "remove"}
                  disabled={safeMode || busy !== null}
                  onClick={() => void onRemove()}
                >
                  <Trash2 size={15} />
                  {t("移除")}
                </Button>
              )}
            </div>
          </div>
        )}

        {value.kind === "url" && (
          <label className={styles.backgroundUrlField}>
            <span>{t("图片链接")}</span>
            <input
              type="url"
              inputMode="url"
              value={value.url}
              placeholder="https://example.com/background.jpg"
              disabled={safeMode}
              aria-invalid={
                value.url.length > 0 &&
                !isRemoteBackgroundUrl(value.url)
              }
              onChange={(event) =>
                onChange({ url: event.currentTarget.value })
              }
            />
            <small>
              {t("仅保存 http/https 地址；取色由浏览器直连，不经过服务器代理。")}
            </small>
          </label>
        )}

        {value.kind !== "none" && (
          <>
            <div
              className={styles.backgroundPreview}
              data-empty={previewUrl ? undefined : "true"}
              role="img"
              aria-label={t("背景预览")}
            >
              {previewUrl ? (
                <>
                  <span
                    className={styles.backgroundPreviewImage}
                    style={{
                      backgroundImage: `url(${JSON.stringify(
                        previewUrl
                      )})`,
                      backgroundPosition: value.position,
                      backgroundRepeat:
                        value.fit === "tile" ? "repeat" : "no-repeat",
                      backgroundSize:
                        value.fit === "tile"
                          ? "auto"
                          : value.fit,
                      filter: `blur(${value.blur}px)`
                    }}
                  />
                  <span
                    className={styles.backgroundPreviewOverlay}
                    style={{
                      opacity: value.overlay
                    }}
                  />
                </>
              ) : (
                <span className={styles.backgroundPreviewEmpty}>
                  {value.kind === "url"
                    ? t("输入有效链接后显示预览")
                    : t("选择图片后显示预览")}
                </span>
              )}
            </div>

            <div className={styles.backgroundTuningGrid}>
              <label>
                <span>{t("填充方式")}</span>
                <select
                  value={value.fit}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      fit: event.currentTarget
                        .value as BackgroundSettings["fit"]
                    })
                  }
                >
                  <option value="cover">{t("覆盖")}</option>
                  <option value="contain">{t("完整显示")}</option>
                  <option value="tile">{t("平铺")}</option>
                </select>
              </label>
              <label>
                <span>{t("对齐位置")}</span>
                <select
                  value={knownBackgroundPosition(value.position)}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({ position: event.currentTarget.value })
                  }
                >
                  <option value="center">{t("居中")}</option>
                  <option value="top">{t("顶部")}</option>
                  <option value="bottom">{t("底部")}</option>
                  <option value="left">{t("左侧")}</option>
                  <option value="right">{t("右侧")}</option>
                </select>
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("遮罩")}
                  <output>{Math.round(value.overlay * 100)}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="90"
                  step="1"
                  value={Math.round(value.overlay * 100)}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      overlay: Number(event.currentTarget.value) / 100
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("模糊")}
                  <output>{value.blur}px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  value={value.blur}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      blur: Number(event.currentTarget.value)
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("页面遮罩")}
                  <output>
                    {Math.round(value.surfaceOpacity * 100)}%
                  </output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="95"
                  step="1"
                  value={Math.round(value.surfaceOpacity * 100)}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      surfaceOpacity: Number(event.currentTarget.value) / 100
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("卡片遮罩")}
                  <output>{Math.round(value.panelOpacity * 100)}%</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="95"
                  step="1"
                  value={Math.round(value.panelOpacity * 100)}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      panelOpacity: Number(event.currentTarget.value) / 100
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("顶栏遮罩")}
                  <output>
                    {Math.round(value.toolbarOpacity * 100)}%
                  </output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="95"
                  step="1"
                  value={Math.round(value.toolbarOpacity * 100)}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      toolbarOpacity: Number(event.currentTarget.value) / 100
                    })
                  }
                />
              </label>
              <label className={styles.backgroundRange}>
                <span>
                  {t("界面模糊")}
                  <output>{value.interfaceBlur}px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  value={value.interfaceBlur}
                  disabled={safeMode}
                  onChange={(event) =>
                    onChange({
                      interfaceBlur: Number(event.currentTarget.value)
                    })
                  }
                />
              </label>
            </div>

            <div className={styles.extractColorRow}>
              <div>
                <strong>{t("从图片生成配色")}</strong>
                <span>
                  {t("提取结果会填入下方四个颜色，不会覆盖主题包文件。")}
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busy === "extract"}
                loadingLabel={t("提取中…")}
                disabled={
                  safeMode ||
                  busy !== null ||
                  !previewUrl
                }
                onClick={() => void onExtract()}
              >
                <Sparkles size={15} />
                {t("提取主题色")}
              </Button>
            </div>
          </>
        )}

        {error !== null && (
          <div className={styles.error}>
            <ErrorBanner
              error={error}
              onDismiss={onDismissError}
            />
            {previewUrl && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={safeMode || busy !== null}
                onClick={() => void onExtract()}
              >
                {t("重试取色")}
              </Button>
            )}
          </div>
        )}
      </div>

  );
}

function BackgroundChoice({
  label,
  checked,
  icon,
  disabled,
  onSelect
}: {
  label: string;
  checked: boolean;
  icon: ReactNode;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={ui(
        styles.backgroundSourceChoice,
        checked && styles.backgroundSourceSelected
      )}
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
    >
      <span aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
      {checked && <Check size={15} aria-hidden="true" />}
    </button>
  );
}

function knownBackgroundPosition(value: string): string {
  return ["center", "top", "bottom", "left", "right"].includes(value)
    ? value
    : "center";
}
