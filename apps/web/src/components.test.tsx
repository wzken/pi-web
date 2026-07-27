import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, IconButton } from "./components";
import { i18next } from "./i18n";
import { ImageAttachmentTray } from "./ImageAttachments";

describe("control primitives", () => {
  it("keeps content in the layout and exposes async state", () => {
    const markup = renderToStaticMarkup(
      <Button loading loadingLabel="保存中…">保存设置</Button>
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("保存设置");
    expect(markup).toContain("保存中…");
  });

  it("gives icon-only controls an accessible name and tooltip", () => {
    const markup = renderToStaticMarkup(
      <IconButton label="刷新状态"><span>↻</span></IconButton>
    );

    expect(markup).toContain('aria-label="刷新状态"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain("刷新状态");
  });

  it("exposes toolbar selection without changing the control structure", () => {
    const markup = renderToStaticMarkup(
      <Button variant="toolbar" active>文件</Button>
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("button-toolbar");
    expect(markup).toContain("is-active");
  });

  it("renders image attachments with names, sizes, and removable controls", async () => {
    const previousLanguage =
      i18next.resolvedLanguage || i18next.language || "zh-CN";
    await i18next.changeLanguage("zh-CN");

    try {
      const markup = renderToStaticMarkup(
        <ImageAttachmentTray
          images={[
            {
              id: "image-1",
              name: "screen.png",
              size: 2048,
              type: "image",
              mimeType: "image/png",
              data: "QQ=="
            }
          ]}
          onChange={() => undefined}
        />
      );

      expect(markup).toContain('aria-label="待发送图片"');
      expect(markup).toContain('alt="screen.png"');
      expect(markup).toContain('aria-label="移除图片 screen.png"');
      expect(markup).toContain("2 KB");
    } finally {
      await i18next.changeLanguage(previousLanguage);
    }
  });
});
