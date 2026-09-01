import { describe, expect, it } from "vitest";
import { sessionTitleFromPrompt } from "./HomePage";

describe("sessionTitleFromPrompt", () => {
  it("uses the first non-empty task line as the session title", () => {
    expect(sessionTitleFromPrompt("检查按钮交互\n并运行测试")).toBe("检查按钮交互");
  });

  it("keeps generated session titles compact", () => {
    const title = sessionTitleFromPrompt("a".repeat(80));

    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });
});
