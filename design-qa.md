# Design QA

## Visual truth

- Account menu reference: `C:/Users/wzken/AppData/Local/Temp/codex-clipboard-78efe68a-4fd6-4251-b90f-56226a984bd4.png`
- Desktop settings reference: `C:/Users/wzken/AppData/Local/Temp/codex-clipboard-5713c62f-961a-4c90-8711-00a193e62f65.png`
- Mobile navigation reference: `C:/Users/wzken/Downloads/Screenshot_20260803-031205_ChatGPT.png`
- Implementation captures:
  - `.runtime/design-qa/desktop-account-menu.png`
  - `.runtime/design-qa/desktop-settings.png`
  - `.runtime/design-qa/desktop-light-shell.png`
  - `.runtime/design-qa/mobile-settings.png`

The supplied ChatGPT/Codex captures are design-direction references rather than a pixel-for-pixel clone target. Pi Web keeps its existing product copy, tokens, controls, and information architecture while matching the reference hierarchy: compact rail, anchored account menu, centered two-pane desktop settings, and a full-width mobile settings flow.

## Capture matrix

| State | Viewport | DPR | Result |
| --- | --- | --- | --- |
| Desktop account menu, dark | 1280 x 720 | 1 | Passed |
| Desktop settings dialog, dark | 1280 x 720 | 1 | Passed |
| Desktop workbench, forced system-light QA state | 1280 x 720 | 1 | Passed |
| Mobile settings, dark | 390 x 844 | 1 | Passed |

The account menu, desktop settings reference, desktop implementation, mobile reference, and mobile implementation were opened together in one comparison input. A separate component crop was not required: the full-view captures keep the menu/dialog relationship to the rail, backdrop, and viewport visible, which is the interaction being validated.

## Findings

- Layout and spacing: the account menu is anchored above the account trigger; the desktop settings dialog remains centered with a compact left navigation and independently scrolling content; the mobile dialog fills the available app area without horizontal overflow.
- Typography and copy: existing Pi Web type scale and product-specific Chinese copy are retained. Titles, section hierarchy, muted supporting copy, and destructive actions follow the supplied references.
- Color and contrast: dark surfaces use the existing neutral palette and lavender action accent. Light mode now applies consistently to the rail, empty-state heading, and composer instead of leaving isolated dark surfaces.
- Controls and focus: account menu items, settings navigation, close button, and save action expose visible hover/focus states. Escape closes the desktop dialog, menu focus is restored to its trigger, and mobile category links scroll the settings content.
- Icons and assets: existing Lucide icons are used consistently; no placeholder imagery or improvised SVG assets were introduced.
- Responsive behavior: 390 x 844 renders a full-width settings view with a three-item icon navigation and a vertically scrollable form. No content collision or clipping remains.
- Runtime: browser error log was empty during final desktop and mobile checks.

## Iteration history

1. Initial mobile settings validation found sections shrinking and visually overlapping (P1). Fixed by preventing settings cards from flex-shrinking and revalidated the 602 px scroll viewport against 2163 px of content.
2. Initial desktop light-mode validation found a dark composer and low-contrast white empty-state heading (P1). Added system-light workbench overrides and revalidated the complete shell.
3. Final desktop and mobile captures showed no remaining P0, P1, or P2 visual defects.

## Unified shell regression pass

### Evidence

- Reported desktop legacy-shell state: `C:/Users/wzken/AppData/Local/Temp/codex-clipboard-8f38cb89-8045-412d-8df9-874060342038.png` (1128 x 1271 pixels).
- Reported mobile overlap state: `C:/Users/wzken/AppData/Local/Temp/codex-clipboard-187c7780-5af8-4d29-a730-e190588149bf.png` (420 x 841 pixels).
- Desired mobile navigation direction: `C:/Users/wzken/Downloads/Screenshot_20260803-031205_ChatGPT.png`.
- Fixed desktop plugin route: `.runtime/design-qa/desktop-plugins-fixed.png` (1280 x 720 pixels, 1280 x 720 CSS viewport, DPR 1).
- Fixed mobile sessions route: `.runtime/design-qa/mobile-sessions-fixed.png` (390 x 844 pixels, 390 x 844 CSS viewport, DPR 1).
- Fixed mobile plugin route: `.runtime/design-qa/mobile-plugins-fixed.png` (390 x 844 pixels, 390 x 844 CSS viewport, DPR 1).

The reported states and revised implementation captures were opened together in one comparison input. The report screenshots document the regressions rather than a pixel-clone target, so density normalization was not used for visual measurements; geometry was verified against CSS viewport rectangles. Full-view comparison was sufficient because the defects affected the shell regions and their boundaries, and all relevant text, controls, and navigation icons remained readable at original size.

### Findings and fixes

1. **P1 — Obsolete desktop shell remained on plugin and schedule routes.** The report showed the old icon-only `aside.sidebar`, while the intended product structure uses project and chat groups. The legacy AppShell sidebar was removed, `/pi` and `/schedules` now use `WorkspacePageShell`, and `/dashboard` redirects to the current home. Post-fix browser evidence found one `.workbench-session-rail` and zero `aside.sidebar` nodes.
2. **P1 — Mobile toolbar overlaid the sessions content.** The grid reserved 52 px while the toolbar painted at 64–80 px. The toolbar token, grid row, and rendered toolbar are now all 64 px. Final geometry measured `toolbar.bottom = 64` and `content.top = 64`, with zero horizontal overflow.
3. **P2 — The mobile page-header action escaped its responsive hide rule.** MDUI button hosts did not receive generated semantic CSS-module classes. `Button` and `IconButton` now resolve their class lists through `ui()`, restoring responsive, hover, focus, and size selectors.
4. **P2 — Mobile navigation used a desktop panel glyph and repeated the page title.** Mobile workbench routes now use the hamburger icon, and the sessions content header is hidden below 760 px because the fixed toolbar owns the page title.
5. **Accessibility and behavior.** The full-screen mobile drawer moves focus to its close control, traps keyboard navigation, closes on Escape, and returns focus to the trigger. E2E coverage asserts toolbar/content geometry, focus restoration, absence of the legacy sidebar, and no horizontal overflow.

### Required fidelity surfaces

- Typography: existing Pi Web fonts, weights, and Chinese copy remain unchanged; the mobile title hierarchy is no longer duplicated.
- Spacing/layout: the desktop rail and content occupy separate grid columns; mobile toolbar and content rows meet without overlap or gaps.
- Colors/tokens: existing dark/system-light tokens are preserved across the shared shell.
- Image quality/assets: no raster product imagery is used on these screens; existing Lucide icons remain sharp and consistently sized.
- Copy/content: project, recent chat, plugin, schedule, and account labels remain product-specific and consistent across viewports.
- Runtime: final desktop and mobile browser error logs were empty.

final result: passed
