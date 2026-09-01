import { describe, expect, it, vi } from "vitest";
import {
  applySystemColorScheme,
  startSystemColorSchemeSync,
  systemColorScheme
} from "./system-color-scheme";

describe("system color scheme", () => {
  it("maps the system dark preference to a color scheme", () => {
    expect(systemColorScheme({ matches: true })).toBe("dark");
    expect(systemColorScheme({ matches: false })).toBe("light");
  });

  it("applies the scheme to native controls and CSS hooks", () => {
    const root = fakeRoot();
    applySystemColorScheme(root, "light");

    expect(root.dataset.colorMode).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("tracks system changes and removes its listener during cleanup", () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, next: () => void) => {
        listener = next;
      }),
      removeEventListener: vi.fn()
    } as unknown as MediaQueryList;

    const root = fakeRoot();
    const stop = startSystemColorSchemeSync(root, media);
    expect(root.dataset.colorMode).toBe("light");

    Object.defineProperty(media, "matches", { value: true });
    listener?.();
    expect(root.dataset.colorMode).toBe("dark");

    stop();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("keeps safe mode light without subscribing to system changes", () => {
    const root = fakeRoot();
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as MediaQueryList;

    startSystemColorSchemeSync(root, media, "light");

    expect(root.dataset.colorMode).toBe("light");
    expect(media.addEventListener).not.toHaveBeenCalled();
  });
});

function fakeRoot(): HTMLElement {
  return {
    dataset: {},
    style: {}
  } as unknown as HTMLElement;
}
