import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThinkingLevelControl, thinkingLevelLabel } from "./ThinkingLevelControl";

describe("ThinkingLevelControl", () => {
  it("renders protocol thinking levels as a discrete accessible range", () => {
    const markup = renderToStaticMarkup(
      <ThinkingLevelControl value="high" onChange={() => undefined} />
    );

    expect(markup).toContain('type="range"');
    expect(markup).toContain('max="6"');
    expect(markup).toContain('value="4"');
    expect(markup).toContain('aria-valuetext="高"');
    expect(markup).toContain("更快");
    expect(markup).toContain("更智能");
  });

  it("adds a distinct default position when global defaults are allowed", () => {
    const markup = renderToStaticMarkup(
      <ThinkingLevelControl allowDefault value="" onChange={() => undefined} />
    );

    expect(markup).toContain('max="7"');
    expect(markup).toContain('value="0"');
    expect(thinkingLevelLabel("")).toBe("跟随默认");
    expect(thinkingLevelLabel("max")).toBe("最大");
  });
});
