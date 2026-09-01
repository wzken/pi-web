import { describe, expect, it } from "vitest";
import {
  applySystemColorScheme,
  initialColorScheme,
  systemColorScheme
} from "./system-color-scheme";

describe("system color scheme", () => {
  it("maps the system dark preference to a color scheme", () => {
    expect(systemColorScheme({ matches: true })).toBe("dark");
    expect(systemColorScheme({ matches: false })).toBe("light");
  });

  it("prefers a stored light/dark mode over the system scheme", () => {
    const storage = { getItem: () => "light" };
    expect(initialColorScheme("?x=1", storage, { matches: true })).toBe(
      "light"
    );
    expect(
      initialColorScheme("?safe-theme=1", storage, { matches: true })
    ).toBe("light");
  });

  it("applies the scheme to native controls and CSS hooks", () => {
    const root = fakeRoot();
    applySystemColorScheme(root, "light");

    expect(root.dataset.colorMode).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });
});

function fakeRoot(): HTMLElement {
  return {
    dataset: {},
    style: {}
  } as unknown as HTMLElement;
}
