import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test("rapid navigation keeps the newest session and file preview", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop workbench race coverage");

  await page.goto("/");
  await page.getByLabel("访问密钥").fill("pi-web-e2e-access");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: /要在 .* 中做什么/ })).toBeVisible();

  const firstName = `delayed session ${Date.now()}`;
  const secondName = `latest session ${Date.now()}`;
  const first = await createSession(page, firstName);
  const second = await createSession(page, secondName);

  await page.goto(`/sessions/${second.id}`);
  await expect(page.getByRole("heading", { name: secondName })).toBeVisible();

  await page.route(`**/api/sessions/${first.id}`, async (route) => {
    await delay(350);
    await route.continue().catch(() => undefined);
  });
  await page.evaluate(
    async ({ firstId, secondId }) => {
      history.pushState({}, "", `/sessions/${firstId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 25));
      history.pushState({}, "", `/sessions/${secondId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    { firstId: first.id, secondId: second.id }
  );

  await expect(page.getByRole("heading", { name: secondName })).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByRole("heading", { name: secondName })).toBeVisible();
  await expect(page.getByRole("heading", { name: firstName })).toHaveCount(0);

  await page.route("**/file-text?*", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "package.json") await delay(350);
    await route.continue().catch(() => undefined);
  });
  await page.getByRole("button", { name: "打开文件面板" }).click();
  const filePane = page.locator(".file-pane");
  await expect(
    filePane.getByRole("button", { name: /^package\.json/ })
  ).toBeVisible();
  await filePane.getByRole("button", { name: /^package\.json/ }).click();
  await filePane.getByRole("button", { name: /^README\.md/ }).click();

  await expect(filePane.locator(".file-preview header strong")).toHaveText(
    "README.md"
  );
  await page.waitForTimeout(450);
  await expect(filePane.locator(".file-preview header strong")).toHaveText(
    "README.md"
  );
});

async function createSession(
  page: Page,
  displayName: string
): Promise<{ id: string }> {
  const response = await page.request.post("/api/sessions", {
    headers: {
      origin: new URL(page.url()).origin
    },
    data: {
      cwd: resolve(process.cwd()),
      displayName,
      prompt: `complete ${displayName}`,
      images: []
    }
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
