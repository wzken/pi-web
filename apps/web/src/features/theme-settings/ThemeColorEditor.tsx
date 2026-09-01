import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { Switch } from "../../components";
import { t } from "../../i18n";
import {
  themeColorPresets,
  type MaterialThemeSettings,
  type ThemeColorRole
} from "../../theme";
import { ui } from "../../ui";
import styles from "../../pages/SettingsPage.module.css";

const colorRoles: ReadonlyArray<{
  role: ThemeColorRole;
  label: string;
  description: string;
}> = [
  {
    role: "primary",
    label: "主色",
    description: "品牌、主要操作与焦点"
  },
  {
    role: "secondary",
    label: "次要色",
    description: "辅助操作与选中状态"
  },
  {
    role: "tertiary",
    label: "第三色",
    description: "强调、提示与高亮"
  },
  {
    role: "neutral",
    label: "中性色",
    description: "背景、表面与边框"
  }
];

export function ThemeColorEditor({
  value,
  disabled,
  onChange
}: {
  value: MaterialThemeSettings;
  disabled: boolean;
  onChange: (value: MaterialThemeSettings) => void;
}) {
  function updateColor(role: ThemeColorRole, color: string) {
    if (!/^#[\da-f]{6}$/i.test(color)) return;
    onChange({
      ...value,
      enabled: true,
      presetId: null,
      colors: {
        ...value.colors,
        [role]: color.toUpperCase()
      }
    });
  }

  return (
    <>
      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("自定义颜色")}</h3>
          <p>
            {t(
              "开启时四色覆盖主题包颜色；关闭后继续使用主题包原有配色。"
            )}
          </p>
        </div>
        <div className={styles.customColorToggle}>
          <div>
            <strong>{t("使用自定义颜色")}</strong>
            <span>
              {value.enabled
                ? t("当前优先使用下方四色")
                : t("当前使用主题包配色")}
            </span>
          </div>
          <Switch
            label={t("使用自定义颜色")}
            checked={value.enabled}
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                enabled: !value.enabled
              })
            }
          />
        </div>
        <div
          className={styles.colorRoleList}
          data-disabled={!value.enabled ? "true" : undefined}
        >
          {colorRoles.map(({ role, label, description }) => {
            const color = value.colors[role];
            const inputId = `theme-color-${role}`;
            return (
              <div className={styles.colorRoleRow} key={role}>
                <label className={styles.colorRoleCopy} htmlFor={inputId}>
                  <strong>{t(label)}</strong>
                  <span>{t(description)}</span>
                </label>
                <label
                  className={styles.colorWell}
                  style={{ "--color-value": color } as CSSProperties}
                  aria-label={t("选择{{name}}", { name: t(label) })}
                >
                  <input
                    id={inputId}
                    type="color"
                    value={validColorValue(color)}
                    disabled={disabled || !value.enabled}
                    onChange={(event) => updateColor(role, event.target.value)}
                  />
                </label>
                <input
                  key={`${role}-${color}`}
                  className={styles.hexInput}
                  aria-label={t("{{name}}十六进制颜色", { name: t(label) })}
                  defaultValue={color.toUpperCase()}
                  disabled={disabled || !value.enabled}
                  spellCheck={false}
                  maxLength={7}
                  pattern="#[0-9A-Fa-f]{6}"
                  onBlur={(event) => {
                    if (/^#[\da-f]{6}$/i.test(event.target.value)) {
                      updateColor(role, event.target.value);
                    } else {
                      event.target.value = color.toUpperCase();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.settingBlock}>
        <div className={styles.blockHeading}>
          <h3>{t("预设色彩盘")}</h3>
          <p>{t("选择一组协调色彩，也可以再单独微调。")}</p>
        </div>
        <div className={styles.paletteGrid}>
          {themeColorPresets.map((preset) => {
            const selected = value.presetId === preset.id;
            return (
              <button
                key={preset.id}
                className={ui(
                  styles.paletteChoice,
                  selected && styles.paletteSelected
                )}
                type="button"
                aria-pressed={selected}
                aria-label={`${t(preset.label)}：${t(preset.description)}`}
                disabled={disabled || !value.enabled}
                onClick={() =>
                  onChange({
                    enabled: true,
                    colors: { ...preset.colors },
                    presetId: preset.id
                  })
                }
              >
                <span className={styles.paletteSwatches} aria-hidden="true">
                  {Object.values(preset.colors).map((color, index) => (
                    <i key={`${preset.id}-${index}`} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span>{t(preset.label)}</span>
                {selected && <Check size={16} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function validColorValue(color: string) {
  return /^#[\da-f]{6}$/i.test(color) ? color : "#54545B";
}
