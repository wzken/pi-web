export type SystemColorScheme = "light" | "dark";

const colorModeStorageKey = "pi-web:color-mode";

export function systemColorScheme(
  media: Pick<MediaQueryList, "matches">
): SystemColorScheme {
  return media.matches ? "dark" : "light";
}

export function initialColorScheme(
  search = window.location.search,
  storage: Pick<Storage, "getItem"> | null = localStorage,
  media: Pick<MediaQueryList, "matches"> = window.matchMedia(
    "(prefers-color-scheme: dark)"
  )
): SystemColorScheme {
  if (new URLSearchParams(search).get("safe-theme") === "1") return "light";
  try {
    const mode = storage?.getItem(colorModeStorageKey);
    if (mode === "light" || mode === "dark") return mode;
  } catch {
    // Private mode still follows the system preference.
  }
  return systemColorScheme(media);
}

export function applySystemColorScheme(
  root: HTMLElement,
  scheme: SystemColorScheme
): void {
  root.dataset.colorMode = scheme;
  root.style.colorScheme = scheme;
}
