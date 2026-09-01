import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Dialog, IconButton, Switch } from "./components";
import { t } from "./i18n";
import { ImageAttachmentTray } from "./ImageAttachments";

describe("control primitives", () => {
  it("keeps content in the layout and exposes async state", () => {
    const markup = renderToStaticMarkup(
      <Button loading loadingLabel="保存中…">保存设置</Button>
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("<button");
    expect(markup).toContain("button-primary");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("保存设置");
    expect(markup).toContain("保存中…");
  });

  it("gives icon-only controls an accessible name and tooltip", () => {
    const markup = renderToStaticMarkup(
      <IconButton label="刷新状态"><span>↻</span></IconButton>
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('aria-label="刷新状态"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain(">刷新状态</span>");
  });

  it("uses native accessible names on buttons", () => {
    const markup = renderToStaticMarkup(
      <Button aria-label="打开运行设置">
        深入
      </Button>
    );

    expect(markup).toContain('aria-label="打开运行设置"');
    expect(markup).toContain('aria-hidden="true">深入</span>');
  });

  it("keeps explicit names stable while a button is loading", () => {
    const markup = renderToStaticMarkup(
      <Button loading aria-label="保存运行设置" loadingLabel="保存中…">
        保存
      </Button>
    );

    expect(markup).toContain('aria-label="保存运行设置"');
    expect(markup).toContain('role="status" aria-hidden="true"');
  });

  it("exposes toolbar selection without changing the control structure", () => {
    const markup = renderToStaticMarkup(
      <Button variant="toolbar" active>文件</Button>
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-app-variant="toolbar"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain("button-toolbar");
  });

  it("keeps the theme dialog hook on native dialog content", () => {
    const markup = renderToStaticMarkup(
      <Dialog open labelledBy="dialog-title" onClose={() => undefined}>
        <h2 id="dialog-title">标题</h2>
      </Dialog>
    );

    expect(markup).toContain("<dialog");
    expect(markup).toMatch(/<div class="[^"]*dialog(?:\s|")[^"]*"/);
  });

  it("renders a controlled native switch", () => {
    const markup = renderToStaticMarkup(
      <Switch
        label="完成提示音"
        checked
        onClick={() => {
          throw new Error("SSR must not invoke interactions");
        }}
      />
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).not.toContain("onClick");
  });

  it("renders image attachments with names, sizes, and removable controls", () => {
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

    expect(markup).toContain(`aria-label="${t("待发送图片")}"`);
    expect(markup).toContain('alt="screen.png"');
    expect(markup).toContain(
      `>${t("移除图片 {{name}}", { name: "screen.png" })}</span>`
    );
    expect(markup).toContain("2 KB");
  });
});
