import { expect, test } from "@playwright/test";

test("follows the system appearance before authentication without nested input surfaces", async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).not.toContain(
    "upgrade-insecure-requests"
  );
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  const darkInput = await page.locator(".login-panel .input-with-icon").evaluate(
    (shell) => ({
      shellBackground: getComputedStyle(shell).backgroundColor,
      inputBackground: getComputedStyle(
        shell.querySelector("input") as HTMLInputElement
      ).backgroundColor
    })
  );
  expect(darkInput.shellBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(darkInput.inputBackground).toBe("rgba(0, 0, 0, 0)");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await page.goto("/?safe-theme=1");
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
});

test("authenticates, runs a durable session, browses files, and schedules work", async ({
  page
}, testInfo) => {
  // This is an intentionally broad durable-workflow smoke test. It covers
  // authentication, session lifecycle, files, terminal, settings, and the
  // scheduler against a real local backend, so slower CI hosts need headroom.
  testInfo.setTimeout(180_000);
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
      ? page.getByRole("button", { name: "搜索" })
      : page
          .locator(".workbench-session-rail")
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

  const piManagerLink = page
    .locator(".workbench-session-rail")
    .getByRole("link", { name: "Pi 管理", exact: true });
  await expect(piManagerLink).toBeVisible();
  await expect(piManagerLink).toHaveAttribute("href", "/pi");

  const projectSectionHeading = page.locator(".sidebar-section-heading").filter({
    has: page.getByText("项目", { exact: true })
  });
  await projectSectionHeading.getByRole("button", { name: "折叠项目" }).click();
  await expect(
    projectSectionHeading.getByRole("button", { name: "展开项目" })
  ).toHaveAttribute("aria-expanded", "false");
  await projectSectionHeading.getByRole("button", { name: "展开项目" }).click();
  await page.getByRole("button", { name: "折叠聊天" }).click();
  await expect(
    page.getByRole("button", { name: "展开聊天" })
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "展开聊天" }).click();
  await expect(
    page.getByRole("link", { name: "查看全部会话", exact: true })
  ).toBeVisible();

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
  const homeComposer = page.locator(".home-composer");
  const homeTaskInput = page.getByLabel("新会话任务");
  expect(
    await homeTaskInput.evaluate((element) => getComputedStyle(element).resize)
  ).toBe("none");
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
    await expect(page.getByRole("button", { name: /添加附件/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "选择工作目录" })).toBeVisible();
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
  const compactHomeHeight = (await homeTaskInput.boundingBox())!.height;
  await homeTaskInput.fill(
    Array.from({ length: 12 }, (_, index) => `自动增高 ${index + 1}`).join("\n")
  );
  const grownHomeHeight = (await homeTaskInput.boundingBox())!.height;
  expect(grownHomeHeight).toBeGreaterThan(compactHomeHeight);
  expect(grownHomeHeight).toBeLessThanOrEqual(
    testInfo.project.name === "mobile" ? 118 : 160
  );
  await expect(page.getByRole("button", { name: "展开输入框" })).toHaveCount(0);
  await homeTaskInput.fill("");

  await homeComposer.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["drop check"], "drop-check.log", {
      type: "text/plain"
    }));
    element.dispatchEvent(new DragEvent("dragenter", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  await expect(page.getByText("拖放图片或文件到这里")).toBeVisible();
  await homeComposer.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["drop check"], "drop-check.log", {
      type: "text/plain"
    }));
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  await expect(homeComposer.getByText("drop-check.log", { exact: true })).toBeVisible();
  await homeComposer.getByRole("button", { name: "移除附件 drop-check.log" }).click();

  await homeComposer.evaluate((element) => {
    const bytes = Uint8Array.from(atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xh5bAAAAAElFTkSuQmCC"
    ), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "drop-image.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });
  await expect(homeComposer.locator(".image-attachment img")).toHaveAttribute(
    "alt",
    "drop-image.png"
  );
  await homeTaskInput.fill(homePrompt);
  await page.getByRole("button", { name: "创建会话并发送" }).click();
  await expect(page.getByRole("heading", { name: homePrompt })).toBeVisible();
  await expect(page.getByText(`Completed: ${homePrompt}`)).toBeVisible({
    timeout: 10_000
  });
  const messageImage = page.getByRole("button", { name: "展开图片" });
  await expect(messageImage).toBeVisible();
  await messageImage.click();
  await expect(page.getByRole("heading", { name: "图片预览" })).toBeVisible();
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(page.getByRole("heading", { name: "图片预览" })).toHaveCount(0);
  const userMessage = page.locator(".message.user").last();
  await expect(userMessage.locator(".message-actions")).toHaveCount(0);
  const assistantMessage = page.locator(".message.assistant").last();
  await expect(assistantMessage.getByRole("button", { name: "复制消息" })).toBeVisible();
  await expect(assistantMessage.getByRole("button", { name: "分享消息" })).toHaveCount(0);
  await expect(assistantMessage.getByRole("button", { name: "删除回复" })).toBeVisible();
  await expect(assistantMessage.getByRole("button", { name: "重试消息" })).toBeVisible();
  await assistantMessage.getByRole("button", { name: "更多消息操作" }).click();
  const messageDownloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "导出消息" }).click();
  expect((await messageDownloadPromise).suggestedFilename()).toMatch(/\.md$/);
  page.once("dialog", (dialog) => dialog.accept());
  await assistantMessage.getByRole("button", { name: "删除回复" }).click();
  await expect(page.getByText(`Completed: ${homePrompt}`)).toHaveCount(0);
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
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "更多会话操作" }).click();
    await page.getByRole("menuitem", { name: "导出" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    await page.getByRole("button", { name: "收起会话栏" }).click();
    await expect(page.getByRole("button", { name: "展开会话栏" })).toBeVisible();
    await page.getByRole("button", { name: "展开会话栏" }).click();

    const [headerBox, titleBox, controlsBox] = await Promise.all([
      page.locator(".session-header").boundingBox(),
      page.getByRole("heading", { name: homePrompt }).boundingBox(),
      page.locator(".session-controls").boundingBox()
    ]);
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(controlsBox!.x);
    expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
      headerBox!.x + headerBox!.width + 1
    );
  }

  const secondPrompt = `slow tool smoke ${suffix}`;
  await page.goto("/");
  await page.getByLabel("新会话任务").fill(secondPrompt);
  await page.getByRole("button", { name: "创建会话并发送" }).click();

  await expect(page.getByRole("button", { name: "停止当前任务" })).toBeVisible();
  await expect(page.getByRole("heading", { name: secondPrompt })).toBeVisible();
  let sessionToDelete = page.url();
  await expect(page.getByText(`Completed: slow tool smoke ${suffix}`)).toBeVisible({
    timeout: 10_000
  });
  await page.reload();
  await expect(page.getByText(`Completed: slow tool smoke ${suffix}`)).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: "更多会话操作" }).click();
    const branchAction = page.getByRole("menuitem", {
      name: "分支概览",
      exact: true
    });
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
      await page
        .getByRole("menuitem", { name: "分支概览", exact: true })
        .click();

      await page.getByRole("button", { name: "更多会话操作" }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("menuitem", { name: "创建分支", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `${secondPrompt} · 分支` })
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(`Completed: slow tool smoke ${suffix}`)
      ).toBeVisible();
      sessionToDelete = page.url();
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
  await expect(page.getByRole("listbox", { name: "可用模型" })).toHaveCount(0);
  await expect(runtimeSettings.getByRole("combobox", { name: "模型", exact: true })).toHaveValue(
    "fake/deterministic"
  );
  const thinkingRange = runtimeSettings.getByLabel("思考级别");
  const runtimeGeometry = await thinkingRange.evaluate((element) => {
    const style = getComputedStyle(element);
    const dialog = element.closest(".session-runtime-dialog") as HTMLElement;
    const dialogRect = dialog.getBoundingClientRect();
    const overflows = Array.from(dialog.querySelectorAll<HTMLElement>("*"))
      .filter((child) => !["absolute", "fixed"].includes(getComputedStyle(child).position))
      .map((child) => ({
        value: child.getBoundingClientRect().right - dialogRect.right,
        name: child.className || child.tagName
      }));
    const widest = overflows.sort((left, right) => right.value - left.value)[0];
    return {
      height: element.getBoundingClientRect().height,
      minHeight: style.minHeight,
      paddingTop: style.paddingTop,
      background: style.backgroundColor,
      overflow: widest?.value ?? 0,
      overflowingElement: String(widest?.name ?? "")
    };
  });
  expect(runtimeGeometry.height).toBeGreaterThanOrEqual(40);
  expect(runtimeGeometry.minHeight).toBe("0px");
  expect(runtimeGeometry.paddingTop).toBe("0px");
  expect(runtimeGeometry.background).toBe("rgba(0, 0, 0, 0)");
  expect(runtimeGeometry.overflow, runtimeGeometry.overflowingElement).toBeLessThanOrEqual(1);
  const runtimeFooterFits = await runtimeSettings
    .locator(".runtime-config-actions")
    .evaluate((footer) => {
      const dialog = footer.closest(".session-runtime-dialog") as HTMLElement;
      const host = dialog.parentElement as HTMLElement & { shadowRoot: ShadowRoot | null };
      const panel = host.shadowRoot?.querySelector<HTMLElement>("[part='panel']");
      const boundary = (panel ?? host).getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const buttons = Array.from(
        footer.querySelectorAll<HTMLElement>("button")
      ).map((button) => button.getBoundingClientRect());
      return (
        footerRect.left >= boundary.left - 1 &&
        footerRect.right <= boundary.right + 1 &&
        footerRect.bottom <= boundary.bottom + 1 &&
        buttons.every(
          (button) =>
            button.left >= footerRect.left - 1 &&
            button.right <= footerRect.right + 1 &&
            button.bottom <= footerRect.bottom + 1
        )
      );
    });
  expect(runtimeFooterFits).toBe(true);
  await thinkingRange.focus();
  await expect(thinkingRange).toHaveAttribute("aria-valuetext", "中");
  await thinkingRange.press("ArrowRight");
  await expect(thinkingRange).toHaveAttribute("aria-valuetext", "高");
  await runtimeSettings
    .getByRole("button", { name: "应用", exact: true })
    .click();
  await expect(runtimeSettings).toBeHidden();
  await expect(page.locator(".composer-meta")).toHaveCount(0);
  await expect(page.locator(".runtime-settings-trigger")).toContainText("高");
  const detailComposer = page.getByLabel("给 Pi 一条新指令…");
  const compactComposerHeight = (await detailComposer.boundingBox())!.height;
  await detailComposer.fill("第一行\n第二行\n第三行\n第四行");
  const expandedComposerHeight = (await detailComposer.boundingBox())!.height;
  expect(expandedComposerHeight).toBeGreaterThan(compactComposerHeight);
  expect(expandedComposerHeight).toBeLessThanOrEqual(160);
  const composerLayout = await page.locator(".composer-toolbar").evaluate((toolbar) => {
    const box = toolbar.getBoundingClientRect();
    const controls = Array.from(toolbar.querySelectorAll<HTMLElement>("button"))
      .map((control) => control.getBoundingClientRect());
    return controls.every((control) => control.left >= box.left && control.right <= box.right);
  });
  expect(composerLayout).toBe(true);
  await detailComposer.fill("");

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
  const contextPrompt = `continue in context ${suffix}`;
  await detailComposer.fill(contextPrompt);
  await page.getByRole("button", { name: /^发送(?:并恢复)?$/ }).click();
  await expect(page.getByText(`Completed: ${contextPrompt}`)).toBeVisible({
    timeout: 10_000
  });

  await page.goto("/schedules");
  const createSchedule = page.getByRole("button", {
    name: /新建调度|创建第一个调度/
  }).first();
  await createSchedule.click();
  await expect(page.getByRole("heading", { name: "新建调度" })).toBeVisible();
  const scheduleDialog = page.locator(
    'dialog[aria-labelledby="schedule-dialog-title"]'
  );
  await page.getByLabel("名称").fill(scheduleName);
  await page.getByLabel("Cron 表达式").fill("0 9 * * *");
  await page.getByLabel("IANA 时区").fill("UTC");
  await scheduleDialog.getByRole("button", { name: "选择目录" }).click();
  const directoryDialog = page.locator(
    'dialog[aria-labelledby="directory-picker-title"]'
  );
  await directoryDialog.getByRole("button", { name: "选择此目录" }).click();
  await expect(directoryDialog).toHaveCount(0);
  await page.getByLabel("Pi 指令").fill(`scheduled smoke ${suffix}`);
  const enabledSwitch = page.locator(
    'button[role="switch"][aria-label="创建后立即启用"]'
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
  const scheduleMenu = page.getByRole("menu");
  await expect(scheduleMenu.getByRole("menuitem", { name: "编辑" })).toBeVisible();
  await expect(scheduleMenu.getByRole("menuitem", { name: "删除" })).toBeVisible();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "立即运行" }).click();
  await expect(page.getByText("已创建立即运行")).toBeVisible();
  const history = page.locator(
    'dialog[aria-labelledby="run-history-title"]'
  );
  await expect(history.getByRole("heading", { name: scheduleName })).toBeVisible();
  await expect(history.getByText("立即运行", { exact: true })).toBeVisible();

  await page.goto("/pi");
  await expect(page.getByRole("heading", { name: "Pi 管理" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "模型与 Provider" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByText("新会话默认值已统一到设置")).toBeVisible();

  if (testInfo.project.name === "desktop") {
    await page.goto(sessionToDelete);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "更多会话操作" }).click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "今天要做什么？", exact: true })
    ).toBeVisible();
  }
});

test("scrolls long conversations and returns to the latest message", async ({
  page
}, testInfo) => {
  testInfo.setTimeout(60_000);

  await page.goto("/");
  await page.getByLabel("访问密钥").fill("pi-web-e2e-access");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(
    page.getByRole("heading", { name: "今天要做什么？", exact: true })
  ).toBeVisible();

  const prompt = `long scroll smoke ${Date.now()}`;
  await page.getByLabel("新会话任务").fill(prompt);
  await page.getByRole("button", { name: "创建会话并发送" }).click();
  await expect(page.getByRole("heading", { name: prompt })).toBeVisible();

  const scroller = page.locator('.message-scroller[data-conversation-scroller="true"]');
  await expect
    .poll(
      () =>
        scroller.evaluate(
          (element) =>
            element.scrollHeight > element.clientHeight &&
            element.scrollHeight - element.clientHeight - element.scrollTop <= 1
        ),
      { timeout: 15_000 }
    )
    .toBe(true);

  const scrollerBox = await scroller.boundingBox();
  expect(scrollerBox).not.toBeNull();
  await page.mouse.move(
    scrollerBox!.x + scrollerBox!.width / 2,
    scrollerBox!.y + scrollerBox!.height / 2
  );
  await page.mouse.wheel(0, -1200);
  const returnToBottom = page.getByRole("button", { name: "回到底部" });
  await expect(returnToBottom).toBeVisible();

  const readingPosition = await scroller.evaluate((element) => element.scrollTop);
  const readingAnchor = await scroller.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    const rows = [
      ...element.querySelectorAll<HTMLElement>("[data-message-anchor-key]")
    ];
    const row = rows.find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    if (!row?.dataset.messageAnchorKey) return null;
    return {
      key: row.dataset.messageAnchorKey,
      top: row.getBoundingClientRect().top - viewport.top
    };
  });
  expect(readingAnchor).not.toBeNull();
  const followUp = `slow scroll follow-up ${Date.now()}`;
  await page.getByLabel("给 Pi 一条新指令…").fill(followUp);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForTimeout(2_000);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(readingPosition + 2);
  await expect
    .poll(() =>
      scroller.evaluate((element, expected) => {
        const row = [
          ...element.querySelectorAll<HTMLElement>("[data-message-anchor-key]")
        ].find(
          (candidate) =>
            candidate.dataset.messageAnchorKey === expected?.key
        );
        if (!row || !expected) return Number.POSITIVE_INFINITY;
        return Math.abs(
          row.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            expected.top
        );
      }, readingAnchor)
    )
    .toBeLessThanOrEqual(2);

  const sessionPath = new URL(page.url()).pathname;
  const sessionRail = page.locator(".workbench-session-rail");
  if (!(await sessionRail.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: /打开会话栏|展开会话栏/ })
      .click();
  }
  await sessionRail.getByRole("link", { name: "会话", exact: true }).click();
  const returnToSession = page.locator(`a[href="${sessionPath}"]`).first();
  await expect(returnToSession).toBeVisible();
  await returnToSession.click();
  await expect(page.getByRole("heading", { name: prompt })).toBeVisible();
  await expect
    .poll(() =>
      scroller.evaluate((element, expected) => {
        const row = [
          ...element.querySelectorAll<HTMLElement>("[data-message-anchor-key]")
        ].find(
          (candidate) =>
            candidate.dataset.messageAnchorKey === expected?.key
        );
        if (!row || !expected) return Number.POSITIVE_INFINITY;
        return Math.abs(
          row.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            expected.top
        );
      }, readingAnchor)
    )
    .toBeLessThanOrEqual(2);

  await returnToBottom.click();
  await expect(page.getByText(`Completed: ${followUp}`, { exact: true })).toBeVisible({
    timeout: 10_000
  });
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop
      )
    )
    .toBeLessThanOrEqual(1);

  const settledBottomDistances = await scroller.evaluate(async (element) => {
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      samples.push(
        element.scrollHeight - element.clientHeight - element.scrollTop
      );
    }
    return samples;
  });
  expect(Math.max(...settledBottomDistances)).toBeLessThanOrEqual(1);
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
