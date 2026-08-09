import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { ThinkingLevelControl, thinkingLevelLabel } from "./ThinkingLevelControl";

describe("ThinkingLevelControl", () => {
  it("renders protocol thinking levels as a discrete accessible range", () => {
    const markup = renderToStaticMarkup(
      <ThinkingLevelControl value="high" onChange={() => undefined} />
    );

    expect(markup).toContain('type="range"');
    expect(markup).toContain('max="6"');
    expect(markup).toContain('value="4"');
    expect(markup).toContain(`aria-valuetext="${t("高")}"`);
    expect(markup).toContain(t("更快"));
    expect(markup).toContain(t("更智能"));
  });

  it("adds a distinct default position when global defaults are allowed", () => {
    const markup = renderToStaticMarkup(
      <ThinkingLevelControl allowDefault value="" onChange={() => undefined} />
    );

    expect(markup).toContain('max="7"');
    expect(markup).toContain('value="0"');
    expect(thinkingLevelLabel("")).toBe(t("跟随默认"));
    expect(thinkingLevelLabel("max")).toBe(t("最大"));
  });
});
