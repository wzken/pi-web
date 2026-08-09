import { setTheme as setMduiTheme } from "mdui/functions/setTheme.js";

export type SystemColorScheme = "light" | "dark";

export function systemColorScheme(
  media: Pick<MediaQueryList, "matches">
): SystemColorScheme {
  return media.matches ? "dark" : "light";
}

export function applySystemColorScheme(
  root: HTMLElement,
  scheme: SystemColorScheme
): void {
  root.dataset.colorMode = scheme;
  root.style.colorScheme = scheme;
  setMduiTheme(scheme, root);
}

export function startSystemColorSchemeSync(
  root: HTMLElement = document.documentElement,
  media: MediaQueryList = window.matchMedia("(prefers-color-scheme: dark)"),
  forcedScheme?: SystemColorScheme
): () => void {
  const update = () =>
    applySystemColorScheme(root, forcedScheme ?? systemColorScheme(media));
  update();
  if (forcedScheme) return () => undefined;
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
