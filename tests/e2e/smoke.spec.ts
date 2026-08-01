import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("initializes login theme before authentication without nested input surfaces", async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const darkInput = await page.locator(".login-panel .input-with-icon").evaluate(
    (shell) => ({
      shellBackground: getComputedStyle(shell).backgroundColor,
      inputBackground: getComputedStyle(
        shell.querySelector("input") as HTMLInputElement
      ).backgroundColor
    })
  );
  expect(darkInput.shellBackground).toBe("rgb(26, 26, 28)");
  expect(darkInput.inputBackground).toBe("rgba(0, 0, 0, 0)");

  await page.goto("/?safe-theme=1");
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  const lightInput = await page.locator(".login-panel .input-with-icon").evaluate(
    (shell) => ({
      shellBackground: getComputedStyle(shell).backgroundColor,
      inputBackground: getComputedStyle(
        shell.querySelector("input") as HTMLInputElement
      ).backgroundColor
    })
  );
  expect(lightInput.shellBackground).toBe("rgb(240, 240, 242)");
  expect(lightInput.inputBackground).toBe("rgba(0, 0, 0, 0)");
});

test("authenticates, runs a durable session, browses files, and schedules work", async ({
  page
}, testInfo) => {
  // This is an intentionally broad durable-workflow smoke test. It covers
  // authentication, session lifecycle, files, terminal, settings, and the
  // scheduler against a real local backend, so slower CI hosts need headroom.
  testInfo.setTimeout(180_000);
  const workspace = resolve(process.cwd());
  const suffix = `${testInfo.project.name}-${testInfo.retry}`;
  const scheduleName = `E2E schedule ${suffix}`;
  const folderName = `E2E folder ${suffix}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "进入你的 Pi Web" })).toBeVisible();
  expect((await page.request.get("/api/sessions")).status()).toBe(401);
  expect(
    (
      await page.request.get(
        "/api/sessions/00000000-0000-4000-8000-000000000000/files"
      )
    ).status()
  ).toBe(401);
  const socketOutcomes = await page.evaluate(
    () =>
      Promise.all(
        ["/api/ws", "/api/terminal"].map(
          (path) =>
            new Promise<"opened" | "rejected">((resolve) => {
              const protocol =
                location.protocol === "https:" ? "wss:" : "ws:";
              const socket = new WebSocket(
                `${protocol}//${location.host}${path}`
              );
              socket.addEventListener("open", () => resolve("opened"), {
                once: true
              });
              socket.addEventListener("error", () => resolve("rejected"), {
                once: true
              });
              window.setTimeout(() => {
                socket.close();
                resolve("rejected");
              }, 2000);
            })
        )
      )
  );
  expect(socketOutcomes).toEqual(["rejected", "rejected"]);
  await page.getByLabel("访问密钥").fill("incorrect");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByText("访问密钥不正确")).toBeVisible();

  await page.getByLabel("访问密钥").fill("pi-web-e2e-access");
  await page.getByRole("button", { name: "安全登录" }).click();
  if (testInfo.project.name === "mobile") {
    await expect(page.getByLabel("新会话任务")).toBeVisible();
  } else {
    await expect(
      page.getByRole("heading", { name: "今天要做什么？", exact: true })
    ).toBeVisible();
  }

  const commandButton =
    testInfo.project.name === "mobile"
      ? page
          .locator(".mobile-header")
          .getByRole("button", { name: "打开命令面板" })
      : page
          .locator(".sidebar-brand")
          .getByRole("button", { name: "打开命令面板" });
  await expect(commandButton).toBeVisible();
  await commandButton.click();
  const commandPalette = page.getByRole("dialog", { name: "命令面板" });
  await expect(commandPalette).toBeVisible();
  await commandPalette.getByRole("combobox").fill("settings");
  await expect(
    commandPalette.getByRole("option", { name: /打开设置/ })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(commandPalette).toBeHidden();

  const expandRail = page.getByRole("button", { name: "展开会话栏" });
  if (await expandRail.isVisible()) await expandRail.click();
  await page.getByRole("button", { name: "创建对话文件夹" }).click();
  await page.getByLabel("对话文件夹名称").fill(folderName);
  await page.getByRole("button", { name: "保存文件夹" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(`${folderName} 0`) })
  ).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.locator(".workbench-rail-backdrop").click({ position: { x: 400, y: 10 } });
  }

  const homePrompt = `homepage smoke ${suffix}`;
  const defaultSystemPrompt = `Answer in Chinese for ${suffix}`;
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true })
  ).toBeVisible();
  await page.getByLabel("默认附加系统提示词").fill(defaultSystemPrompt);
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存")).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("新会话任务")).toBeVisible();
  const homeComposerBar = page.locator(".home-composer-bar");
  await expect(homeComposerBar).toHaveCSS("display", "flex");
  if (testInfo.project.name === "desktop") {
    const toolsBox = await page.locator(".home-composer-tools").boundingBox();
    const sendBox = await page
      .getByRole("button", { name: "创建会话并发送" })
      .boundingBox();
    expect(toolsBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(sendBox!.x).toBeGreaterThan(toolsBox!.x + toolsBox!.width);
  } else {
    const composerBox = await page.locator(".home-composer").boundingBox();
    const viewport = page.viewportSize();
    expect(composerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(
      viewport!.height
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight
        )
      )
      .toBeLessThanOrEqual(1);
  }
  await page.getByLabel("新会话任务").fill(homePrompt);
  await page.getByRole("button", { name: "创建会话并发送" }).click();
  await expect(page.getByRole("heading", { name: homePrompt })).toBeVisible();
  await expect(page.getByText(`Completed: ${homePrompt}`)).toBeVisible({
    timeout: 10_000
  });
  const sessionActions = page.getByRole("button", { name: "更多会话操作" });
  await sessionActions.click();
  await page.getByRole("menuitem", { name: "系统" }).click();
  await expect(sessionActions).toBeFocused();
  await expect(page.locator(".workbench-system-prompt")).toContainText(
    defaultSystemPrompt
  );
  await page.getByRole("button", { name: "关闭系统信息" }).click();
  await expect(page.locator(".workbench-system-prompt")).toHaveCount(0);

  if (testInfo.project.name === "desktop") {
    await page.getByRole("link", { name: new RegExp(homePrompt) }).hover();
    await page.getByRole("button", { name: `会话操作 ${homePrompt}` }).click();
    await page.getByRole("menuitem", { name: folderName, exact: true }).click();
    await expect(
      page.getByRole("button", { name: new RegExp(`${folderName} 1`) })
    ).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "更多会话操作" }).click();
    await page.getByRole("menuitem", { name: "导出" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await page.getByRole("button", { name: "收起会话栏" }).click();
    await expect(page.getByRole("button", { name: "展开会话栏" })).toBeVisible();
    await page.getByRole("button", { name: "展开会话栏" }).click();
  }

  const secondPrompt = `slow tool smoke ${suffix}`;
  await page.goto("/");
  await page.getByLabel("新会话任务").fill(secondPrompt);
  await page.getByRole("button", { name: "创建会话并发送" }).click();

  await expect(page.getByRole("heading", { name: secondPrompt })).toBeVisible();
  await expect(page.getByText(`Completed: slow tool smoke ${suffix}`)).toBeVisible({
    timeout: 10_000
  });
  await page.reload();
  await expect(page.getByText(`Completed: slow tool smoke ${suffix}`)).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: "更多会话操作" }).click();
    const branchAction = page.getByRole("menuitem", { name: "分支" });
    if (await branchAction.isVisible()) {
      await branchAction.click();
      const treePanel = page.getByRole("complementary", {
        name: "会话分支概览"
      });
      await expect(treePanel).toBeVisible();
      await expect(treePanel.locator(".session-tree-row.is-current")).toHaveCount(
        1
      );
      await page.getByRole("button", { name: "更多会话操作" }).click();
      await page.getByRole("menuitem", { name: "分支" }).click();
    } else {
      await page.keyboard.press("Escape");
    }
  }

  await page.getByRole("button", { name: "更多会话操作" }).click();
  await page.getByRole("menuitem", { name: "终端" }).click();
  const terminalPanel = page.getByRole("region", { name: "会话终端" });
  await expect(terminalPanel).toBeVisible();
  if (testInfo.project.name === "desktop") {
    await terminalPanel.getByRole("button", { name: "启动终端" }).click();
    await expect(terminalPanel.getByText("已连接")).toBeVisible({
      timeout: 10_000
    });
    const terminalInput = terminalPanel.locator(".xterm-helper-textarea");
    await terminalInput.click();
    await page.keyboard.type("echo PI_WEB_TERMINAL_OK");
    await page.keyboard.press("Enter");
    await expect(terminalPanel.locator(".xterm-rows")).toContainText(
      "PI_WEB_TERMINAL_OK",
      { timeout: 10_000 }
    );
    await terminalPanel.getByRole("button", { name: "停止" }).click();
    await expect(terminalPanel.getByText("已退出")).toBeVisible({
      timeout: 10_000
    });
  } else {
    await expect(
      terminalPanel.locator('footer[aria-label="终端快捷键"]')
    ).toBeVisible();
    await terminalPanel.getByRole("button", { name: "缩回终端" }).click();
    await expect(terminalPanel).toHaveAttribute("data-collapsed", "true");
    await expect(terminalPanel).toHaveClass(/is-collapsed/);
    const collapsedLayout = await terminalPanel.evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const composer = document.querySelector(".composer-shell")?.getBoundingClientRect();
      return {
        insideViewport: panel.left >= 0 && panel.right <= window.innerWidth,
        aboveComposer: composer ? panel.bottom < composer.top : false
      };
    });
    expect(collapsedLayout).toEqual({
      insideViewport: true,
      aboveComposer: true
    });
    await expect(
      terminalPanel.locator('footer[aria-label="终端快捷键"]')
    ).toBeHidden();
    await terminalPanel.getByRole("button", { name: "展开终端" }).click();
    await expect(terminalPanel).toHaveAttribute("data-collapsed", "false");
    await expect(terminalPanel.getByText("未启动")).toBeVisible();
    await expect(terminalPanel.getByRole("alert")).toHaveCount(0);
    await expect(
      terminalPanel.locator('footer[aria-label="终端快捷键"]')
    ).toBeVisible();
  }
  await terminalPanel.getByRole("button", { name: "关闭终端面板" }).click();
  await expect(terminalPanel).toBeHidden();

  await page
    .getByRole("button", { name: "设置当前会话的模型和思考级别" })
    .click();
  const runtimeSettings = page.getByRole("dialog", {
    name: "模型与思考级别"
  });
  await expect(runtimeSettings).toBeVisible();
  await expect(runtimeSettings.getByLabel("模型")).toHaveValue(
    "fake/deterministic"
  );
  await runtimeSettings.getByLabel("思考级别").selectOption("high");
  await runtimeSettings
    .getByRole("button", { name: "应用", exact: true })
    .click();
  await expect(runtimeSettings).toBeHidden();
  await expect(page.locator(".composer-meta")).toContainText("high");

  const readme = page.getByRole("button", { name: /^README\.md/ });
  if (!(await readme.isVisible())) {
    const openFilePanel = page.getByRole("button", { name: "打开文件面板" });
    if (await openFilePanel.isVisible()) {
      await openFilePanel.click();
    } else {
      await page.getByRole("button", { name: "打开文件" }).click();
    }
  }
  await expect(readme).toBeVisible();
  await readme.click();
  await expect(page.locator(".file-preview header strong")).toHaveText("README.md");
  await expect(page.getByRole("heading", { name: "Pi Web" })).toBeVisible();
  await page.getByRole("button", { name: "关闭预览" }).click();
  const closeFiles = page.getByRole("button", {
    name: "关闭文件",
    exact: true
  });
  if (await closeFiles.isVisible()) await closeFiles.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "更多会话操作" }).click();
  await page.getByRole("menuitem", { name: "关闭会话" }).click();
  await expect(page.getByText("会话 Worker 已关闭")).toBeVisible();
  await expect(page.locator(".status-pill.status-closed")).toHaveCount(1);
  const resumedPrompt = `resume in context ${suffix}`;
  await page.getByRole("textbox").fill(resumedPrompt);
  await page.getByRole("button", { name: "发送并恢复" }).click();
  await expect(page.getByText(`Completed: ${resumedPrompt}`)).toBeVisible({
    timeout: 10_000
  });

  await page.goto("/schedules");
  const createSchedule = page.getByRole("button", {
    name: /新建调度|创建第一个调度/
  }).first();
  await createSchedule.click();
  await expect(page.getByRole("heading", { name: "新建调度" })).toBeVisible();
  await page.getByLabel("名称").fill(scheduleName);
  await page.getByLabel("Cron 表达式").fill("0 9 * * *");
  await page.getByLabel("IANA 时区").fill("UTC");
  await page.getByLabel("工作目录").fill(workspace);
  await page.getByLabel("Pi 指令").fill(`scheduled smoke ${suffix}`);
  const enabledSwitch = page.locator(
    'mdui-switch[aria-label="创建后立即启用"]'
  );
  await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
  await enabledSwitch.click();
  await expect(enabledSwitch).toHaveAttribute("aria-checked", "false");
  await enabledSwitch.click();
  await expect(enabledSwitch).toHaveAttribute("aria-checked", "true");
  const saveSchedule = page.getByRole("button", { name: "保存调度" });
  await saveSchedule.scrollIntoViewIfNeeded();
  await saveSchedule.click({ trial: true });
  const scheduleActionLayout = await saveSchedule.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
    return {
      insideVisualViewport:
        buttonRect.top >= viewportTop && buttonRect.bottom <= viewportBottom
    };
  });
  expect(scheduleActionLayout).toEqual({
    insideVisualViewport: true
  });
  const saveScheduleBounds = await saveSchedule.boundingBox();
  expect(saveScheduleBounds).not.toBeNull();
  const saveSchedulePoint = {
    x: saveScheduleBounds!.x + saveScheduleBounds!.width / 2,
    y: saveScheduleBounds!.y + saveScheduleBounds!.height / 2
  };
  if (testInfo.project.name === "mobile") {
    await page.touchscreen.tap(saveSchedulePoint.x, saveSchedulePoint.y);
  } else {
    await page.mouse.click(saveSchedulePoint.x, saveSchedulePoint.y);
  }
  const card = page.locator("article", { hasText: scheduleName });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `更多调度操作 ${scheduleName}` }).click();
  await expect(card.getByRole("menuitem", { name: "编辑" })).toBeVisible();
  await expect(card.getByRole("menuitem", { name: "删除" })).toBeVisible();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "立即运行" }).click();
  await expect(page.getByText("已创建立即运行")).toBeVisible();
  const history = page.locator(
    'mdui-dialog[aria-labelledby="run-history-title"]'
  );
  await expect(history.getByRole("heading", { name: scheduleName })).toBeVisible();
  await expect(history.getByText("立即运行", { exact: true })).toBeVisible();

  await page.goto("/pi");
  await expect(page.getByRole("heading", { name: "Pi 管理" })).toBeVisible();
  await expect(page.getByText("PI RUNTIME")).toBeVisible();
});

test("switches and persists the interface language", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Language persistence coverage");

  await page.goto("/");
  await page.getByLabel("访问密钥").fill("pi-web-e2e-access");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(
    page.getByRole("heading", { name: "今天要做什么？", exact: true })
  ).toBeVisible();
  await page.goto("/settings");

  await page.getByLabel("语言").selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveValue("en-US");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true })
  ).toBeVisible();

  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true })
  ).toBeVisible();
});
