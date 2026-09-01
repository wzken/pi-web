import { describe, expect, it } from "vitest";
import type { InstalledTheme, ThemeCatalog } from "@pi-web/protocol";
import {
  resolveActiveTheme,
  resolveColorScheme,
  themeSupportsColorScheme,
  themeTokensForScheme
} from "./theme";

const piNeutral = dualTheme("pi-neutral", "built-in");
const customLight = theme("custom-light", "light", "uploaded");
const adaptive = dualTheme("adaptive", "uploaded");

describe("resolveActiveTheme", () => {
  it("keeps a selected theme when its color scheme matches", () => {
    expect(resolveActiveTheme(catalog("custom-light"), "light")?.id).toBe(
      "custom-light"
    );
  });

  it("falls back to the neutral built-in scheme in automatic mode", () => {
    expect(resolveActiveTheme(catalog("custom-light"), "dark")?.id).toBe(
      "pi-neutral"
    );
  });

  it("keeps a dual-mode theme when the color scheme changes", () => {
    expect(resolveActiveTheme(catalog("adaptive"), "light")?.id).toBe(
      "adaptive"
    );
    expect(resolveActiveTheme(catalog("adaptive"), "dark")?.id).toBe(
      "adaptive"
    );
  });

  it("forces the neutral built-in theme in safe mode", () => {
    expect(resolveActiveTheme(catalog("adaptive"), "dark", true)?.id).toBe(
      "pi-neutral"
    );
  });
});

describe("dual-mode theme helpers", () => {
  it("selects tokens for the resolved scheme", () => {
    expect(themeSupportsColorScheme(adaptive, "light")).toBe(true);
    expect(themeSupportsColorScheme(adaptive, "dark")).toBe(true);
    expect(themeTokensForScheme(adaptive, "light")["--bg"]).toBe("#fff");
    expect(themeTokensForScheme(adaptive, "dark")["--bg"]).toBe("#111");
  });
});

describe("resolveColorScheme", () => {
  it("uses an explicit mode immediately", () => {
    expect(resolveColorScheme("dark", "light")).toBe("dark");
    expect(resolveColorScheme("light", "dark")).toBe("light");
  });

  it("tracks the system scheme in automatic mode", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
    expect(resolveColorScheme("system", "light")).toBe("light");
  });
});

function catalog(themeId: string): ThemeCatalog {
  return {
    themes: [piNeutral, customLight, adaptive],
    preferences: {
      themeId,
      colorMode: "system",
      background: {
        kind: "none",
        url: "",
        fit: "cover",
        position: "center",
        overlay: 0.18,
        blur: 0,
        surfaceOpacity: 0.22,
        panelOpacity: 0.58,
        toolbarOpacity: 0.48,
        interfaceBlur: 8
      },
      materialTheme: {
        enabled: false,
        colors: {
          primary: "#54545B",
          secondary: "#69656C",
          tertiary: "#5D6765",
          neutral: "#77777A"
        },
        presetId: "graphite"
      }
    }
  };
}

function dualTheme(
  id: string,
  source: InstalledTheme["source"]
): InstalledTheme {
  return {
    schemaVersion: 2,
    id,
    name: id,
    version: "2",
    description: "",
    author: "Pi Web",
    schemes: {
      light: { tokens: { "--bg": "#fff" } },
      dark: { tokens: { "--bg": "#111" } }
    },
    source,
    updatedAt: "2026-07-27T00:00:00.000Z"
  };
}

function theme(
  id: string,
  colorScheme: "light" | "dark",
  source: InstalledTheme["source"] = "built-in"
): InstalledTheme {
  return {
    schemaVersion: 1,
    id,
    name: id,
    version: "1",
    description: "",
    author: "Pi Web",
    colorScheme,
    tokens: {},
    source,
    updatedAt: "2026-07-25T00:00:00.000Z"
  };
}
