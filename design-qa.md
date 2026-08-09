# Design QA

## Scope

- Adaptive new-session and session composers, including long text, explicit expand/collapse, file/image drag and drop, attachment loading states, and image preview.
- Runtime settings dialogs, especially model/thinking controls and the bottom action area on desktop and narrow viewports.
- Message image loading and expanded preview states.

## Visual truth

User references:

- `C:/Users/wzken/.codex/attachments/a9c82f06-bc38-405e-87ff-78a6bdad4dfe/image-1.png`
- `C:/Users/wzken/.codex/attachments/a9c82f06-bc38-405e-87ff-78a6bdad4dfe/image-2.png`
- `C:/Users/wzken/.codex/attachments/a9c82f06-bc38-405e-87ff-78a6bdad4dfe/image-3.png`
- `C:/Users/wzken/.codex/attachments/a9c82f06-bc38-405e-87ff-78a6bdad4dfe/image-4.png`
- `C:/Users/wzken/.codex/attachments/a9c82f06-bc38-405e-87ff-78a6bdad4dfe/image-5.png`

Implementation captures:

- `.runtime/design-qa/composer-expanded-desktop.png`
- `.runtime/design-qa/runtime-dialog-desktop.png`

The source expanded-composer reference and both implementation captures were reviewed together at original resolution. The implementation viewport was 1280 × 720 CSS pixels at device scale factor 1.

## Comparison history

### Pass 1

- P1: The attachment tooltip was clipped by the rounded composer and obscured the input. Removed the decorative tooltip while retaining the accessible button name.
- P1: The browser-native textarea resize handle allowed uncontrolled growth and displaced the toolbar. Disabled native resize and added bounded automatic height plus an explicit expand/collapse control.
- P1: Runtime-dialog actions could fall below a second scroll container. Unified the runtime-dialog DOM, kept heading/actions fixed, and moved scrolling to the settings grid.
- P1: Image attachments had no reading/loading affordance or expanded message preview. Added loading/error states and an accessible preview dialog.

### Pass 2

- Expanded composer remains within the work area, keeps attachment/runtime/send controls inside the bottom toolbar, and scrolls only after reaching its height cap.
- Runtime dialog shows both bottom actions without clipping; model and thinking controls remain aligned.
- File/image drops are announced and reuse the existing validated attachment pipeline. Sending is disabled while files are still being read.
- Narrow action layouts collapse to one column at 360 px and below.
- No remaining P0, P1, or P2 visual differences were observed in the reviewed states.

## Interaction and responsive verification

- Desktop and mobile Playwright smoke coverage passes for drag/drop, image attachment submission, image preview, composer autosizing/expansion, runtime controls, and footer geometry.
- Desktop visual inspection passed for collapsed/expanded composer and runtime settings dialog.
- Computed composer style: `resize: none`; automatic height caps at 160 px desktop and 118 px mobile before internal scrolling.
- Keyboard labels, dialog focus behavior, and accessibility lint pass.
- Browser console was checked during the final preview; no blocking runtime error was observed.

## Surface review

- Typography: existing Pi Web scale and weights retained.
- Spacing: composer controls stay inside the rounded container; dialog footer has safe-area-aware spacing.
- Color: existing dark system palette retained; loading/error states use current tokens.
- Images: thumbnails preserve aspect ratio, expose removal, show reading progress, and open a contain-fit preview.
- Copy: upload/loading/drop/preview states have Chinese and English labels.

final result: passed
