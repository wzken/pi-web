import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import type { ThemeCatalog } from "@pi-web/protocol";

const accessKey = "pi-web-e2e-access";

test.describe("MDUI control regressions", () => {
  test("a settings switch changes exactly once per click", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The control behavior is viewport-independent"
    );

    await authenticate(page, "/settings");
    await expect(
      page.getByRole("heading", { name: "设置", exact: true })
    ).toBeVisible();

    const soundSwitch = page.locator(
      'mdui-switch[aria-label="完成提示音"]'
    );
    await expect(soundSwitch).toHaveCount(1);
    await expect(soundSwitch).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => readSwitchChecked(soundSwitch)).toBe(false);

    await page.evaluate(() => {
      document.documentElement.dataset.notificationStateEvents = "0";
      window.addEventListener("pi-web:notification-state", () => {
        const root = document.documentElement;
        const count = Number(root.dataset.notificationStateEvents ?? "0");
        root.dataset.notificationStateEvents = String(count + 1);
      });
    });

    await soundSwitch.click();

    await expect(soundSwitch).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => readSwitchChecked(soundSwitch)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.dataset.notificationStateEvents
        )
      )
      .toBe("1");
    expect(
      await page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("pi-web:notification-preferences") ?? "{}"
        ) as { sound?: boolean };
        return saved.sound;
      })
    ).toBe(true);
  });

  test("background sources and four-role colors persist through appearance settings", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop covers the server-backed appearance workflow"
    );

    await authenticate(page, "/settings");
    const origin = new URL(page.url()).origin;
    const backgroundFile = page.locator(
      'input[type="file"][accept*="image/png"]'
    );
    await backgroundFile.setInputFiles(
      resolve("docs", "assets", "preview-login.png")
    );

    await expect(
      page.getByText("背景图片已上传，可继续调整显示方式")
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "背景预览" })).toBeVisible();
    await page.getByRole("button", { name: "提取主题色" }).click();
    await expect(
      page.getByText("已从背景提取四色，可继续单独微调")
    ).toBeVisible();
    await expect(
      page.locator('mdui-switch[aria-label="使用自定义颜色"]')
    ).toHaveAttribute("aria-checked", "true");

    const colors = {
      主色: "#123456",
      次要色: "#654321",
      第三色: "#336699",
      中性色: "#777777"
    } as const;
    for (const [label, color] of Object.entries(colors)) {
      const input = page.getByLabel(`${label}十六进制颜色`);
      await input.fill(color);
      await input.press("Enter");
      await expect(input).toHaveValue(color.toUpperCase());
    }

    await applyAppearance(page);
    let response = await page.request.get("/api/themes");
    expect(response.ok()).toBe(true);
    let catalog = (await response.json()) as ThemeCatalog;
    expect(catalog.preferences).toMatchObject({
      background: { kind: "upload" },
      materialTheme: {
        enabled: true,
        colors: {
          primary: colors.主色,
          secondary: colors.次要色,
          tertiary: colors.第三色,
          neutral: colors.中性色
        },
        presetId: null
      }
    });

    await page.getByRole("radio", { name: "图片链接" }).click();
    const remoteUrl = "https://images.example.test/pi-web-background.png";
    await page.getByRole("textbox", { name: "图片链接" }).fill(remoteUrl);
    await applyAppearance(page);
    response = await page.request.get("/api/themes");
    catalog = (await response.json()) as ThemeCatalog;
    expect(catalog.preferences.background).toMatchObject({
      kind: "url",
      url: remoteUrl
    });

    await page.reload();
    await expect(page.getByRole("radio", { name: "图片链接" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(page.getByRole("textbox", { name: "图片链接" })).toHaveValue(
      remoteUrl
    );
    await expect(page.getByLabel("主色十六进制颜色")).toHaveValue(
      colors.主色
    );

    await page.getByRole("button", { name: "恢复默认" }).click();
    await applyAppearance(page);
    const removeResponse = await page.request.delete("/api/themes/background", {
      headers: { origin }
    });
    expect(removeResponse.ok()).toBe(true);
  });

  test("a form IconButton closes its controlled dialog without submitting and restores focus", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop covers form semantics and focus restoration"
    );

    await authenticate(page, "/schedules");
    const createSchedule = page
      .getByRole("button", { name: /新建调度|创建第一个调度/ })
      .first();
    await expect(createSchedule).toBeVisible();
    await createSchedule.click();

    const dialog = page.locator(
      'mdui-dialog[aria-labelledby="schedule-dialog-title"]'
    );
    await expect(dialog).toBeVisible();
    await page.getByLabel("名称").fill(`No submit ${Date.now()}`);
    await page.getByLabel("工作目录").fill(process.cwd());
    await page.getByLabel("Pi 指令").fill("This form must not be submitted.");

    let schedulePostCount = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "POST" &&
        url.pathname === "/api/schedules"
      ) {
        schedulePostCount += 1;
      }
    });

    const closeButton = dialog.getByRole("button", {
      name: "关闭调度编辑"
    });
    const closeButtonHost = dialog
      .locator("mdui-button-icon")
      .filter({ hasText: "关闭调度编辑" });
    await expect(closeButtonHost).toHaveAttribute("type", "button");
    await closeButton.click();

    await expect(dialog).toHaveCount(0);
    await expect(createSchedule).toBeFocused();
    expect(schedulePostCount).toBe(0);
  });

  test("the schedule dialog has no horizontal overflow at a narrow mobile width", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Mobile-only responsive regression"
    );

    await page.setViewportSize({ width: 320, height: 740 });
    await authenticate(page, "/schedules");
    await page
      .getByRole("button", { name: /新建调度|创建第一个调度/ })
      .first()
      .click();

    const dialog = page.locator(
      'mdui-dialog[aria-labelledby="schedule-dialog-title"]'
    );
    await expect(dialog).toBeVisible();

    const layout = await dialog.evaluate((host) => {
      const panel = host.shadowRoot?.querySelector<HTMLElement>(
        '[part~="panel"]'
      );
      const body = host.shadowRoot?.querySelector<HTMLElement>(
        '[part~="body"]'
      );
      if (!panel || !body) throw new Error("MDUI dialog parts are unavailable");

      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const bodyOverflowX = getComputedStyle(body).overflowX;
      return {
        bodyOverflowX,
        documentOverflow:
          document.documentElement.scrollWidth - viewportWidth,
        panelLeft: panelRect.left,
        panelRightOverflow: panelRect.right - viewportWidth,
        scrollableBody:
          body.scrollWidth > body.clientWidth + 1 &&
          !["clip", "hidden"].includes(bodyOverflowX)
      };
    });

    expect(layout.bodyOverflowX).toBe("hidden");
    expect(layout.documentOverflow).toBeLessThanOrEqual(1);
    expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.panelRightOverflow).toBeLessThanOrEqual(1);
    expect(layout.scrollableBody).toBe(false);
  });
});

async function authenticate(page: Page, path: string): Promise<void> {
  await page.goto("/");
  const response = await page.request.post("/api/auth/login", {
    headers: { origin: new URL(page.url()).origin },
    data: { key: accessKey }
  });
  expect(response.ok()).toBe(true);
  await page.goto(path);
}

async function applyAppearance(page: Page): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "PUT" &&
      url.pathname === "/api/themes/preferences"
    );
  });
  await page.getByRole("button", { name: "应用外观" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(page.getByText("外观已应用").last()).toBeVisible();
}

async function readSwitchChecked(
  locator: ReturnType<Page["locator"]>
): Promise<boolean> {
  return locator.evaluate(
    (element) => (element as HTMLElement & { checked: boolean }).checked
  );
}
