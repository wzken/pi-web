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

async function readSwitchChecked(
  locator: ReturnType<Page["locator"]>
): Promise<boolean> {
  return locator.evaluate(
    (element) => (element as HTMLElement & { checked: boolean }).checked
  );
}
