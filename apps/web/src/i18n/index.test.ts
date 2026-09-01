import { describe, expect, it } from "vitest";
import { t } from "./index";

describe("i18n", () => {
  it("uses Chinese source text for zh-CN", () => {
    expect(t("新会话", {}, "zh-CN")).toBe("新会话");
  });

  it("translates known messages and interpolates values", () => {
    expect(
      t("最近有 {{count}} 个会话需要留意", { count: 2 }, "en-US")
    ).toBe("2 recent session(s) need attention");
  });

  it("falls back to source text when a translation is not registered", () => {
    expect(t("Pi Web", {}, "en-US")).toBe("Pi Web");
  });
});
