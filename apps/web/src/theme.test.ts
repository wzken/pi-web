import { describe, expect, it } from "vitest";
import type { InstalledTheme, ThemeCatalog } from "@pi-web/protocol";
import {
  resolveActiveTheme,
  resolveColorScheme,
  themeSupportsColorScheme,
  themeTokensForScheme
} from "./theme";

const light = theme("agegr-light", "light");
const dark = theme("agegr-dark", "dark");
const customLight = theme("custom-light", "light", "uploaded");
const adaptive = dualTheme();

describe("resolveActiveTheme", () => {
  it("keeps a selected theme when its color scheme matches", () => {
    expect(resolveActiveTheme(catalog("custom-light"), "light")?.id).toBe(
      "custom-light"
    );
  });

  it("falls back to the built-in opposite scheme in automatic mode", () => {
    expect(resolveActiveTheme(catalog("custom-light"), "dark")?.id).toBe(
      "agegr-dark"
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

  it("forces the light built-in theme in safe mode", () => {
    expect(resolveActiveTheme(catalog("agegr-dark"), "dark", true)?.id).toBe(
      "agegr-light"
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
    themes: [light, dark, customLight, adaptive],
    preferences: {
      themeId,
      colorMode: "system",
      background: {
        kind: "none",
        url: "",
        fit: "cover",
        position: "center",
        overlay: 0.18,
        blur: 0
      }
    }
  };
}

function dualTheme(): InstalledTheme {
  return {
    schemaVersion: 2,
    id: "adaptive",
    name: "adaptive",
    version: "2",
    description: "",
    author: "Pi Web",
    schemes: {
      light: { tokens: { "--bg": "#fff" } },
      dark: { tokens: { "--bg": "#111" } }
    },
    source: "uploaded",
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
