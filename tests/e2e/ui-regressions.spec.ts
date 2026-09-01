import { expect, test, type Page } from "@playwright/test";

const accessKey = "pi-web-e2e-access";

test.describe("native control regressions", () => {
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
      'button[role="switch"][aria-label="完成提示音"]'
    );
    await expect(soundSwitch).toHaveCount(1);
    await expect(soundSwitch).toHaveAttribute("aria-checked", "false");

    await soundSwitch.click();

    await expect(soundSwitch).toHaveAttribute("aria-checked", "true");
    expect(
      await page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("pi-web:notification-preferences") ?? "{}"
        ) as { sound?: boolean; browser?: boolean };
        return { sound: saved.sound, hasRetiredBrowserFlag: "browser" in saved };
      })
    ).toEqual({ sound: true, hasRetiredBrowserFlag: false });
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
      'dialog[aria-labelledby="schedule-dialog-title"]'
    );
    await expect(dialog).toBeVisible();
    await page.getByLabel("名称").fill(`No submit ${Date.now()}`);
    await dialog.getByRole("button", { name: "选择目录" }).click();
    const directoryDialog = page.locator(
      'dialog[aria-labelledby="directory-picker-title"]'
    );
    await directoryDialog.getByRole("button", { name: "选择此目录" }).click();
    await expect(directoryDialog).toHaveCount(0);
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
    await expect(closeButton).toHaveAttribute("type", "button");
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
          skills: [],
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
      'dialog[aria-labelledby="new-session-runtime-title"]'
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

  test("Pi Skills are complete and the mobile page scrolls from inside the list", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Mobile-only Skills and touch scrolling regression"
    );

    const skills = [
      "bing-search",
      "browser",
      "browser-tools",
      "deploy-to-vercel",
      "find-skills",
      "vercel-composition-patterns",
      "vercel-react-best-practices",
      "web-design-guidelines"
    ].map((name) => ({
      name,
      description: `${name} deterministic test description `.repeat(3),
      path:
        name === "browser"
          ? "/packages/browser/skills/browser/SKILL.md"
          : `/home/test/.pi/agent/skills/${name}/SKILL.md`,
      scope: "user",
      source: name === "browser" ? "npm:@getpipher/browser" : "auto"
    }));

    await page.route("**/api/pi", async (route) => {
      await route.fulfill({
        json: {
          available: true,
          executable: "pi",
          version: "0.84.1",
          models: Array.from({ length: 12 }, (_, index) => ({
            provider: "fake",
            id: `model-${index + 1}`,
            label: `fake model-${index + 1}`
          })),
          skills,
          packages: ["npm:@getpipher/browser"],
          errors: []
        }
      });
    });

    await authenticate(page, "/pi?tab=skills");

    await expect(page.getByRole("tab", { name: "Skills" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page).toHaveURL(/\/pi\?tab=skills$/);
    await expect(page).toHaveTitle(/Pi 管理 · Pi Web$/);
    await expect(page.getByRole("heading", { name: "当前可用 Skills" })).toBeVisible();
    for (const skill of skills) {
      await expect(page.getByText(skill.name, { exact: true })).toHaveCount(1);
    }
    await expect(page.getByText("npm:@getpipher/browser", { exact: true })).toBeVisible();

    const geometry = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      touchAction: getComputedStyle(
        document.querySelector<HTMLElement>(".workspace-page-content")!
      ).touchAction,
      topbarPosition: getComputedStyle(
        document.querySelector<HTMLElement>(".workbench-topbar")!
      ).position
    }));
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.touchAction).toBe("pan-y");
    expect(geometry.topbarPosition).toBe("sticky");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: 195, y: 700, radiusX: 8, radiusY: 8, force: 1 }]
    });
    for (let index = 1; index <= 18; index += 1) {
      await page.waitForTimeout(16);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            id: 1,
            x: 195,
            y: 700 - (580 * index) / 18,
            radiusX: 8,
            radiusY: 8,
            force: 1
          }
        ]
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector<HTMLElement>(".workbench-topbar")!
              .getBoundingClientRect().top
        )
      )
      .toBe(0);
  });

  test("the project action opens the working-directory picker", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop validates the persistent rail action"
    );

    await authenticate(page, "/");
    await page.getByRole("button", { name: "添加项目" }).click();
    const directoryDialog = page.locator(
      'dialog[aria-labelledby="directory-picker-title"]'
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
      'dialog[aria-labelledby="schedule-dialog-title"]'
    );
    await expect(dialog).toBeVisible();

    const layout = await dialog.evaluate((host) => {
      const panel = host.querySelector<HTMLElement>(".dialog");
      if (!panel) throw new Error("Native dialog panel is unavailable");

      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const panelOverflowX = getComputedStyle(panel).overflowX;
      return {
        panelOverflowX,
        documentOverflow:
          document.documentElement.scrollWidth - viewportWidth,
        panelLeft: panelRect.left,
        panelRightOverflow: panelRect.right - viewportWidth,
        scrollablePanel:
          panel.scrollWidth > panel.clientWidth + 1 &&
          !["clip", "hidden"].includes(panelOverflowX)
      };
    });

    expect(layout.documentOverflow).toBeLessThanOrEqual(1);
    expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.panelRightOverflow).toBeLessThanOrEqual(1);
    expect(layout.scrollablePanel).toBe(false);
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

  test("appearance and active navigation remain wired after authentication", async ({
    page
  }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("访问密钥").fill(accessKey);
    await page.getByRole("button", { name: "安全登录" }).click();
    await expect(page.getByLabel("新会话任务")).toBeVisible();

    await page.goto("/settings#appearance");
    await expect(page.locator("html")).toHaveAttribute("data-theme-id", "pi-neutral");
    await expect(page.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
    const openRail = async () => {
      const trigger = page.getByRole("button", { name: "展开会话栏" });
      if (testInfo.project.name === "mobile") {
        await expect(trigger).toBeVisible();
        await trigger.click();
        await expect(page.locator(".workbench-session-rail")).toBeVisible();
      }
    };
    await openRail();
    await expect(
      page.getByRole("button", { name: "打开账户菜单" })
    ).toHaveAttribute("data-active", "true");
    await expect(
      page.locator("nav").getByRole("link", { name: "外观", exact: true })
    ).toHaveAttribute("aria-current", "location");

    await page.goto("/pi?tab=packages");
    await openRail();
    await expect(page.getByRole("tab", { name: "Packages" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page).toHaveTitle(/Pi 管理 · Pi Web$/);
    await expect(
      page.locator(".workbench-session-rail").getByRole("link", { name: "Pi 管理", exact: true })
    ).toHaveAttribute("aria-current", "page");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "关闭任务侧栏" }).click();
      await expect(page.locator(".workbench-session-rail")).toHaveCount(0);
    }

    const modelsTab = page.getByRole("tab", { name: "模型与 Provider" });
    await modelsTab.click();
    await expect(page).toHaveURL(/\/pi$/);
    await expect(modelsTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveTitle(/Pi 管理 · Pi Web$/);
    await openRail();
    await expect(
      page.locator(".workbench-session-rail").getByRole("link", { name: "Pi 管理", exact: true })
    ).toHaveAttribute("aria-current", "page");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "关闭任务侧栏" }).click();
    }

    await page.getByRole("tab", { name: "Packages" }).click();
    await expect(page).toHaveURL(/\/pi\?tab=packages$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/pi$/);
    await expect(modelsTab).toHaveAttribute("aria-selected", "true");
  });

  test("session history filters and sorting persist in the URL", async ({
    page
  }) => {
    await authenticate(page, "/sessions?filter=attention&sort=tools&q=missing");

    await expect(page.getByRole("button", { name: "需处理" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByLabel("排序")).toHaveValue("tools");
    await expect(page.getByLabel("搜索名称、工作目录或模型")).toHaveValue(
      "missing"
    );
    await expect(
      page.getByRole("heading", { name: "没有符合当前条件的会话" })
    ).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(
      /\/sessions\?filter=attention&sort=tools&q=missing$/
    );
    await page.getByRole("button", { name: "重置视图" }).first().click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole("button", { name: "全部", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByLabel("排序")).toHaveValue("recent");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      )
      .toBe(0);
  });

  test("extension UI survives refresh and resumes the blocked worker", async ({
    page
  }) => {
    await authenticate(page, "/");
    const created = await page.request.post("/api/sessions", {
      headers: { origin: new URL(page.url()).origin },
      data: {
        cwd: process.cwd(),
        displayName: `Extension UI ${Date.now()}`,
        prompt: "extension-confirm",
        images: []
      }
    });
    expect(created.ok()).toBe(true);
    const session = (await created.json()) as { id: string };

    try {
      await page.goto(`/sessions/${encodeURIComponent(session.id)}`);
      const dialog = page.getByRole("dialog", { name: "Allow fake operation?" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText("The fake extension is waiting for a browser decision.")
      ).toBeVisible();

      await page.reload();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText("Fake extension request was confirmed.", { exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
          )
        )
        .toBe(0);
    } finally {
      await page.request.post(
        `/api/sessions/${encodeURIComponent(session.id)}/close`,
        { headers: { origin: new URL(page.url()).origin } }
      );
    }
  });

  test("notification inbox deep-links pending supervision and resolves it", async ({
    page
  }, testInfo) => {
    await authenticate(page, "/");
    const displayName = `Notification inbox ${testInfo.project.name} ${Date.now()}`;
    const created = await page.request.post("/api/sessions", {
      headers: { origin: new URL(page.url()).origin },
      data: {
        cwd: process.cwd(),
        displayName,
        prompt: "extension-confirm",
        images: []
      }
    });
    expect(created.ok()).toBe(true);
    const session = (await created.json()) as { id: string };

    try {
      await page.goto("/notifications?filter=attention");
      await expect(
        page.getByRole("heading", { name: "通知中心", exact: true })
      ).toBeVisible();
      const row = page.locator(".notification-row", { hasText: displayName });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText("需处理", { exact: true })).toBeVisible();
      await expect(row.getByRole("link", { name: "立即处理" })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
          )
        )
        .toBe(0);

      await row.getByRole("link", { name: "立即处理" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/sessions/${session.id}$`)
      );
      const dialog = page.getByRole("dialog", { name: "Allow fake operation?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(
        page.getByText("Fake extension request was confirmed.", { exact: true })
      ).toBeVisible({ timeout: 15_000 });

      await page.goto("/notifications");
      const resolved = page
        .locator(".notification-row", { hasText: displayName })
        .filter({
          has: page.getByText("Pi 正在等待你的决定", { exact: true })
        });
      await expect(resolved).toBeVisible();
      await expect(resolved.getByText("已处理", { exact: true })).toBeVisible();
      await expect(resolved.getByText("需处理", { exact: true })).toHaveCount(0);
      await expect(
        page
          .locator(".notification-row", { hasText: displayName })
          .filter({
            has: page.getByText("Pi 已完成当前工作", { exact: true })
          })
      ).toBeVisible();

      await page.goto("/settings#security");
      const remoteAccess = page.getByRole("heading", {
        name: "远程入口",
        exact: true
      });
      await expect(remoteAccess).toBeVisible({ timeout: 15_000 });
      await expect(page.getByAltText("首选远程地址二维码")).toBeVisible();
      await expect(page.getByText("首选地址", { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth
          )
        )
        .toBe(0);
    } finally {
      await page.request.post(
        `/api/sessions/${encodeURIComponent(session.id)}/close`,
        { headers: { origin: new URL(page.url()).origin } }
      );
    }
  });

  test("mobile back closes workspace layers before leaving the session", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "The back-stack coordinator is active only at mobile widths"
    );
    await authenticate(page, "/");
    const created = await page.request.post("/api/sessions", {
      headers: { origin: new URL(page.url()).origin },
      data: {
        cwd: process.cwd(),
        displayName: `Mobile back ${Date.now()}`,
        images: []
      }
    });
    expect(created.ok()).toBe(true);
    const session = (await created.json()) as { id: string };

    try {
      await page.goto(`/sessions/${encodeURIComponent(session.id)}`);
      const closeRail = page.getByRole("button", { name: "关闭会话栏" });
      if (await closeRail.isVisible().catch(() => false)) await closeRail.click();
      await page.getByRole("button", { name: "打开文件面板" }).click();
      await expect(page.locator(".file-pane-open")).toBeVisible();

      await page.goBack();
      await expect(page.locator(".file-pane-open")).toHaveCount(0);
      await expect(page).toHaveURL(
        new RegExp(`/sessions/${session.id}$`)
      );

      await page.goBack();
      await expect(page).toHaveURL(/\/sessions$/);
    } finally {
      await page.request.post(
        `/api/sessions/${encodeURIComponent(session.id)}/close`,
        { headers: { origin: new URL(page.url()).origin } }
      );
    }
  });

  test("action menus render in a viewport-level portal", async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Desktop covers the compact PC viewport regression"
    );

    await page.setViewportSize({ width: 568, height: 153 });
    await authenticate(page, "/");
    const created = await page.request.post("/api/sessions", {
      headers: { origin: new URL(page.url()).origin },
      data: {
        cwd: process.cwd(),
        displayName: `Portal menu ${Date.now()}`,
        images: []
      }
    });
    expect(created.ok()).toBe(true);
    const session = (await created.json()) as { id: string };

    try {
      await page.goto(`/sessions/${encodeURIComponent(session.id)}`);
      const actionButton = page.getByRole("button", {
        name: "更多会话操作"
      });
      await expect(actionButton).toBeVisible();
      await actionButton.click();

      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const geometry = await menu.evaluate((element) => {
        const popup = element.parentElement as HTMLElement;
        const rect = element.getBoundingClientRect();
        return {
          portalled: popup.parentElement === document.body,
          position: getComputedStyle(popup).position,
          zIndex: Number(getComputedStyle(popup).zIndex),
          top: rect.top,
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth
        };
      });
      expect(geometry.portalled).toBe(true);
      expect(geometry.position).toBe("fixed");
      expect(geometry.zIndex).toBeGreaterThanOrEqual(1000);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    } finally {
      await page.request.post(
        `/api/sessions/${encodeURIComponent(session.id)}/close`,
        { headers: { origin: new URL(page.url()).origin } }
      );
    }
  });

  test("custom backgrounds stay visible through workbench surfaces", async ({
    page
  }) => {
    await authenticate(page, "/");
    await expect(page.locator(".home-start-content")).toBeVisible();
    await page.evaluate(() => {
      const root = document.documentElement;
      root.dataset.hasBackground = "true";
      root.style.setProperty(
        "--app-background-image",
        "linear-gradient(#123456, #123456)"
      );
      root.style.setProperty("--app-background-size", "cover");
      root.style.setProperty("--app-background-repeat", "no-repeat");
      root.style.setProperty("--app-background-position", "center");
      root.style.setProperty("--app-background-overlay", "0");
      root.style.setProperty("--app-background-blur", "0px");
    });

    const surfaces = await page.evaluate(() => {
      const background = (selector: string) =>
        getComputedStyle(document.querySelector(selector) as HTMLElement)
          .backgroundColor;
      return {
        root: background("#root"),
        shell: background(".app-shell"),
        page: background(".page"),
        workbench: background(".home-workbench"),
        start: background(".home-start"),
        content: background(".home-start-content"),
        image: getComputedStyle(document.body, "::before").backgroundImage
      };
    });
    const isTranslucent = (value: string) => {
      if (value === "rgba(0, 0, 0, 0)") return true;
      const alpha = value.match(/\/\s*(0(?:\.\d+)?|1(?:\.0+)?)\)/)?.[1]
        ?? value.match(/rgba\([^,]+,[^,]+,[^,]+,\s*(0(?:\.\d+)?|1(?:\.0+)?)\)/)?.[1];
      return alpha !== undefined && Number(alpha) < 1;
    };
    expect(surfaces.root).toBe("rgba(0, 0, 0, 0)");
    expect(surfaces.shell).toBe("rgba(0, 0, 0, 0)");
    for (const surface of [
      surfaces.page,
      surfaces.workbench,
      surfaces.start,
      surfaces.content
    ]) {
      expect(isTranslucent(surface), surface).toBe(true);
    }
    expect(surfaces.image).toBe(
      "linear-gradient(rgb(18, 52, 86), rgb(18, 52, 86))"
    );
  });

  test("the sessions page fits the mobile viewport without horizontal cropping", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile viewport regression");

    await authenticate(page, "/sessions");
    await expect(page.getByRole("heading", { name: "会话" }).last()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const selectors = [
        ".workspace-page-content",
        ".sessions-workbench-content",
        ".redesign-metric-strip",
        ".redesign-list-toolbar",
        ".redesign-session-list",
        ".redesign-session-row"
      ];
      return {
        viewportWidth,
        documentWidth: document.documentElement.scrollWidth,
        elements: selectors.flatMap((selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return [];
          const rect = element.getBoundingClientRect();
          return [{ selector, left: rect.left, right: rect.right, width: rect.width }];
        })
      };
    });

    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    for (const element of geometry.elements) {
      expect(element.left, element.selector).toBeGreaterThanOrEqual(-1);
      expect(element.right, element.selector).toBeLessThanOrEqual(
        geometry.viewportWidth + 1
      );
    }
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
