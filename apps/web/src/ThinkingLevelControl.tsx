import type { CSSProperties } from "react";
import { thinkingLevels, type ThinkingLevel } from "@pi-web/protocol";
import { t } from "./i18n";
import { ui } from "./ui";

export function ThinkingLevelControl({
  value,
  allowDefault = false,
  disabled = false,
  onChange
}: {
  value: ThinkingLevel | "";
  allowDefault?: boolean;
  disabled?: boolean;
  onChange: (value: ThinkingLevel | "") => void;
}) {
  const values: ReadonlyArray<ThinkingLevel | ""> = allowDefault
    ? ["", ...thinkingLevels]
    : thinkingLevels;
  const fallbackIndex = allowDefault ? 0 : thinkingLevels.indexOf("medium");
  const currentIndex = Math.max(values.indexOf(value), fallbackIndex);
  const progress = values.length <= 1
    ? 0
    : (currentIndex / (values.length - 1)) * 100;

  return (
    <div
      className={ui("thinking-level-control")}
      data-disabled={disabled ? "true" : undefined}
      style={{ "--thinking-progress": `${progress}%` } as CSSProperties}
    >
      <div className={ui("thinking-level-track")}>
        <input
          type="range"
          min={0}
          max={values.length - 1}
          step={1}
          value={currentIndex}
          disabled={disabled}
          aria-label={t("思考级别")}
          aria-valuetext={thinkingLevelLabel(values[currentIndex] ?? "")}
          onChange={(event) => {
            onChange(values[Number(event.target.value)] ?? "");
          }}
        />
        <div className={ui("thinking-level-ticks")} aria-hidden="true">
          {values.map((level, index) => (
            <i
              className={ui(index <= currentIndex ? "is-active" : "")}
              key={level || "default"}
            />
          ))}
        </div>
      </div>
      <div className={ui("thinking-level-labels")}>
        <span>{t("更快")}</span>
        <strong>{thinkingLevelLabel(values[currentIndex] ?? "")}</strong>
        <span>{t("更智能")}</span>
      </div>
    </div>
  );
}

export function thinkingLevelLabel(level: ThinkingLevel | ""): string {
  switch (level) {
    case "":
      return t("跟随默认");
    case "off":
      return t("关闭思考");
    case "minimal":
      return t("极简");
    case "low":
      return t("低");
    case "medium":
      return t("中");
    case "high":
      return t("高");
    case "xhigh":
      return t("超高");
    case "max":
      return t("最大");
  }
}
