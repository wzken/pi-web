import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { PiWebPaths } from "@pi-web/config";
import { ThemeService } from "./themes.js";

let root = "";
let service: ThemeService;

beforeEach(async () => {
  const testRoot = resolve(process.cwd(), ".runtime/tests");
  await mkdir(testRoot, { recursive: true });
  root = await mkdtemp(join(testRoot, "theme-service-"));
  service = new ThemeService(testPaths(root));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("ThemeService", () => {
  it("uses the agegr-inspired built-in theme by default", async () => {
    const catalog = await service.catalog();
    expect(catalog.preferences.themeId).toBe("agegr-light");
    expect(catalog.preferences.colorMode).toBe("system");
    expect(catalog.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agegr-light",
          source: "built-in",
          colorScheme: "light"
        }),
        expect.objectContaining({
          id: "agegr-dark",
          source: "built-in",
          colorScheme: "dark"
        })
      ])
    );
  });

  it("installs a declarative ZIP and persists the active theme", async () => {
    const archive = zipSync({
      "my-theme/theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          id: "remote-calm",
          name: "Remote Calm",
          version: "1.2.0",
          colorScheme: "light",
          tokens: { "--teal": "#176b5b", "--radius": "8px" },
          css: "theme.css",
          background: {
            image: "assets/background.png",
            fit: "cover",
            position: "center",
            overlay: 0.2,
            blur: 0
          }
        })
      ),
      "my-theme/theme.css": strToU8(".panel { border-radius: var(--radius); }"),
      "my-theme/assets/background.png": new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10
      ])
    });

    const installed = await service.install(Buffer.from(archive));
    expect(installed.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "remote-calm",
          source: "uploaded",
          cssUrl: expect.stringContaining("/api/theme-assets/remote-calm/theme.css"),
          backgroundUrl: expect.stringContaining(
            "/api/theme-assets/remote-calm/assets/background.png"
          )
        })
      ])
    );

    const updated = await service.updatePreferences({
      ...installed.preferences,
      themeId: "remote-calm"
    });
    expect(updated.preferences.themeId).toBe("remote-calm");
    expect(
      JSON.parse(
        await readFile(join(root, "config", "appearance.json"), "utf8")
      )
    ).toMatchObject({ themeId: "remote-calm" });
  });

  it.each([
    ["geist-workbench.zip", "geist-workbench"],
    ["material-3-workbench.zip", "material-3-workbench"]
  ])("installs the bundled %s theme pack", async (archiveName, themeId) => {
    const archive = await readFile(
      resolve(process.cwd(), "theme-packs", "dist", archiveName)
    );

    const installed = await service.install(archive);
    expect(installed.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: themeId,
          source: "uploaded",
          schemaVersion: 2,
          schemes: {
            light: { tokens: expect.any(Object) },
            dark: { tokens: expect.any(Object) }
          },
          cssUrl: expect.stringContaining(`/api/theme-assets/${themeId}/theme.css`)
        })
      ])
    );
  });

  it("installs one package with both color schemes", async () => {
    const archive = zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 2,
          id: "adaptive-theme",
          name: "Adaptive Theme",
          version: "2.0.0",
          schemes: {
            light: { tokens: { "--bg": "#ffffff", "--text": "#111111" } },
            dark: { tokens: { "--bg": "#111111", "--text": "#ffffff" } }
          }
        })
      )
    });

    const installed = await service.install(Buffer.from(archive));
    expect(installed.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "adaptive-theme",
          schemaVersion: 2,
          schemes: {
            light: { tokens: expect.objectContaining({ "--bg": "#ffffff" }) },
            dark: { tokens: expect.objectContaining({ "--bg": "#111111" }) }
          }
        })
      ])
    );
  });

  it("rejects executable CSS constructs", async () => {
    const archive = zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          id: "unsafe-theme",
          name: "Unsafe",
          version: "1",
          css: "theme.css"
        })
      ),
      "theme.css": strToU8("@import url(https://example.com/style.css);")
    });

    await expect(service.install(Buffer.from(archive))).rejects.toMatchObject({
      code: "THEME_CSS_UNSAFE"
    });
  });

  it("validates remote background URLs", async () => {
    await expect(
      service.updatePreferences({
        themeId: "agegr-light",
        background: {
          kind: "url",
          url: "file:///private/background.png",
          fit: "cover",
          position: "center",
          overlay: 0.2,
          blur: 0
        }
      })
    ).rejects.toMatchObject({ code: "BACKGROUND_URL_INVALID" });
  });

  it("migrates preferences without a color mode to follow the system", async () => {
    const configDir = join(root, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "appearance.json"),
      JSON.stringify({
        themeId: "agegr-light",
        background: {
          kind: "none",
          url: "",
          fit: "cover",
          position: "center",
          overlay: 0.18,
          blur: 0
        }
      }),
      "utf8"
    );

    const catalog = await service.catalog();
    expect(catalog.preferences.colorMode).toBe("system");
  });
});

function testPaths(base: string): PiWebPaths {
  const configDir = join(base, "config");
  const dataDir = join(base, "data");
  return {
    configDir,
    configFile: join(configDir, "config.json"),
    dataDir,
    cacheDir: join(base, "cache"),
    databaseFile: join(dataDir, "pi-web.sqlite"),
    socketPath: join(base, "sessiond.sock"),
    ipcTokenFile: join(dataDir, "runtime", "ipc-server-token"),
    runtimeDir: join(dataDir, "runtime")
  };
}
