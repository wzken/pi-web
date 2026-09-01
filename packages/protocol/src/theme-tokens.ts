export const themeTokenNames = [
  "--bg",
  "--bg-raised",
  "--panel",
  "--panel-2",
  "--panel-3",
  "--line",
  "--line-soft",
  "--text",
  "--text-soft",
  "--text-dim",
  "--lime",
  "--lime-ink",
  "--teal",
  "--violet",
  "--amber",
  "--red",
  "--blue",
  "--shadow",
  "--radius",
  "--radius-sm",
  "--font-ui",
  "--font-mono"
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];
