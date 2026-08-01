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
  it("uses the dual-mode neutral built-in theme by default", async () => {
    const catalog = await service.catalog();
    expect(catalog.preferences.themeId).toBe("pi-neutral");
    expect(catalog.preferences.colorMode).toBe("system");
    expect(catalog.themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pi-neutral",
          source: "built-in",
          schemaVersion: 2,
          schemes: {
            light: { tokens: expect.any(Object) },
            dark: { tokens: expect.any(Object) }
          }
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

  it("rejects theme packages that try to override shell geometry", async () => {
    const archive = zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          id: "layout-override",
          name: "Layout override",
          version: "1",
          tokens: { "--sidebar": "320px" }
        })
      )
    });

    await expect(service.install(Buffer.from(archive))).rejects.toMatchObject({
      code: "THEME_MANIFEST_INVALID"
    });
  });

  it("rejects shell geometry overrides in theme CSS", async () => {
    const archive = zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          id: "layout-css-override",
          name: "Layout CSS override",
          version: "1",
          css: "theme.css"
        })
      ),
      "theme.css": strToU8(":root { --workspace-app-rail: 320px; }")
    });

    await expect(service.install(Buffer.from(archive))).rejects.toMatchObject({
      code: "THEME_CSS_LAYOUT_TOKEN"
    });
  });

  it("does not reload an older installed theme with layout CSS", async () => {
    const packageDir = join(
      root,
      "data",
      "themes",
      "packages",
      "legacy-layout"
    );
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "theme.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "legacy-layout",
        name: "Legacy layout",
        version: "1",
        css: "theme.css"
      }),
      "utf8"
    );
    await writeFile(
      join(packageDir, "theme.css"),
      ":root { --sidebar: 320px; }",
      "utf8"
    );

    const catalog = await service.catalog();
    expect(catalog.themes.some((theme) => theme.id === "legacy-layout")).toBe(
      false
    );
  });

  it("keeps retired built-in IDs reserved", async () => {
    const archive = zipSync({
      "theme.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          id: "agegr-light",
          name: "Retired theme",
          version: "1",
          colorScheme: "light"
        })
      )
    });

    await expect(service.install(Buffer.from(archive))).rejects.toMatchObject({
      code: "THEME_ID_RESERVED"
    });
  });

  it("validates remote background URLs", async () => {
    await expect(
      service.updatePreferences({
        themeId: "pi-neutral",
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
        themeId: "pi-neutral",
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

  it("migrates a removed built-in theme without discarding user appearance", async () => {
    const configDir = join(root, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "appearance.json"),
      JSON.stringify({
        themeId: "agegr-dark",
        colorMode: "dark",
        background: {
          kind: "url",
          url: "https://example.com/background.jpg",
          fit: "contain",
          position: "top",
          overlay: 0.42,
          blur: 3
        }
      }),
      "utf8"
    );

    const catalog = await service.catalog();
    expect(catalog.preferences).toMatchObject({
      themeId: "pi-neutral",
      colorMode: "dark",
      background: {
        kind: "url",
        url: "https://example.com/background.jpg",
        fit: "contain",
        position: "top",
        overlay: 0.42,
        blur: 3
      }
    });
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
