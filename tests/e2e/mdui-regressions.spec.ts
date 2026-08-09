import { expect, test, type Page } from "@playwright/test";

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

  test("model and runtime dialogs survive repeated open, escape, and reopen cycles", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop covers the full runtime settings interaction"
    );

    await page.route("**/api/pi", async (route) => {
      await route.fulfill({
        json: {
          available: true,
          executable: "pi",
          version: "test",
          models: [
            { provider: "fake", id: "deterministic", label: "raw table row" },
            { provider: "fake", id: "switched", label: "another raw row" }
          ],
          packages: [],
          errors: []
        }
      });
    });

    await authenticate(page, "/");
    const runtimeTrigger = page.getByRole("button", {
      name: "设置工作目录、模型、思考级别和附加提示词"
    });
    await runtimeTrigger.click();

    const runtimeDialog = page.locator(
      'mdui-dialog[aria-labelledby="new-session-runtime-title"]'
    );
    await expect(runtimeDialog).toBeVisible();
    const modelToggle = runtimeDialog.getByRole("button", {
      name: "打开模型列表"
    });

    for (let index = 0; index < 3; index += 1) {
      await modelToggle.click();
      await expect(page.getByRole("listbox", { name: "可用模型" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox", { name: "可用模型" })).toHaveCount(0);
      await expect(runtimeDialog).toBeVisible();
    }

    await modelToggle.click();
    const modelInput = runtimeDialog.getByRole("combobox", { name: "模型" });
    await modelInput.fill("switched");
    await expect(page.getByText("fake", { exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: /switched/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /deterministic/ })).toHaveCount(0);
    await modelInput.press("ArrowDown");
    await expect(modelInput).toHaveAttribute("aria-activedescendant", /option-0$/);
    await modelInput.press("Enter");
    await expect(modelInput).toHaveValue("fake/switched");
    await expect(page.getByRole("listbox", { name: "可用模型" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(runtimeDialog).toHaveCount(0);
    await expect(runtimeTrigger).toBeFocused();
    await runtimeTrigger.click();
    await expect(runtimeDialog).toBeVisible();
  });

  test("the project action opens the working-directory picker", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop validates the persistent rail action"
    );

    await authenticate(page, "/");
    await page.getByRole("button", { name: "新建项目" }).click();
    const directoryDialog = page.locator(
      'mdui-dialog[aria-labelledby="directory-picker-title"]'
    );
    await expect(directoryDialog).toBeVisible();
    await expect(directoryDialog.getByRole("heading", { name: "选择工作目录" })).toBeVisible();
    await directoryDialog.getByRole("button", { name: "关闭目录选择" }).click();
    await expect(directoryDialog).toHaveCount(0);
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

  test("the mobile workbench aligns content below its toolbar and restores drawer focus", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Mobile-only navigation accessibility regression"
    );

    await authenticate(page, "/sessions");
    const trigger = page.getByRole("button", { name: "展开会话栏" });
    const topbar = page.locator(".workbench-topbar");
    const content = page.locator(".sessions-workbench-content");
    const primaryAction = page.locator(".sessions-page-primary-action");

    await expect(topbar).toBeVisible();
    await expect(content).toBeVisible();
    await expect(primaryAction).toBeHidden();
    const geometry = await page.evaluate(() => {
      const toolbarRect = document
        .querySelector<HTMLElement>(".workbench-topbar")!
        .getBoundingClientRect();
      const contentRect = document
        .querySelector<HTMLElement>(".sessions-workbench-content")!
        .getBoundingClientRect();
      return {
        toolbarBottom: toolbarRect.bottom,
        contentTop: contentRect.top,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      };
    });
    expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.toolbarBottom);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await trigger.click();

    const sidebar = page.locator(".workbench-session-rail");
    await expect(sidebar).toBeVisible();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        sidebar.evaluate((node) => node.contains(document.activeElement))
      )
      .toBe(true);

    await page.keyboard.press("Escape");

    await expect(sidebar).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("plugin and schedule routes use only the workbench session rail", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop keeps the shared rail mounted for structural verification"
    );

    for (const path of ["/pi?tab=packages", "/schedules"]) {
      await authenticate(page, path);
      await expect(page.locator("aside.sidebar")).toHaveCount(0);
      await expect(page.locator(".workbench-session-rail")).toHaveCount(1);
      await expect(page.locator(".workbench-session-rail")).toBeVisible();
    }
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

async function readSwitchChecked(
  locator: ReturnType<Page["locator"]>
): Promise<boolean> {
  return locator.evaluate(
    (element) => (element as HTMLElement & { checked: boolean }).checked
  );
}
