# Pi Web theme packs / Pi Web 主题包

[English](#english) | [简体中文](#简体中文)

## English

This directory contains two independently implemented, installable themes:

| Theme | Source | ZIP |
| --- | --- | --- |
| Geist Workbench | `geist-workbench/` | `dist/geist-workbench.zip` |
| Material 3 Workbench | `material-3-workbench/` | `dist/material-3-workbench.zip` |

Both use `schemaVersion: 2`, with `schemes.light` and `schemes.dark` in one
manifest. Selecting the system color mode switches schemes without changing
the theme ID.

### Package structure

```text
my-theme.zip
└─ my-theme/
   ├─ theme.json
   ├─ theme.css
   └─ assets/
      ├─ preview.webp
      ├─ background.webp
      └─ ui.woff2
```

Minimal dual-mode manifest:

```json
{
  "schemaVersion": 2,
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "schemes": {
    "light": { "tokens": { "--bg": "#f6f7f4", "--text": "#20241f" } },
    "dark": { "tokens": { "--bg": "#0b0b0c", "--text": "#f5f5f6" } }
  },
  "css": "theme.css"
}
```

Legacy `schemaVersion: 1` single-mode themes remain supported. Theme IDs must
use lowercase kebab-case. Archives are limited to 8 MB compressed, 20 MB
unpacked, and 240 files.

Allowed assets are CSS, PNG, JPEG, WebP, GIF, AVIF, WOFF/WOFF2, TTF, and OTF.
JavaScript, HTML, SVG, path traversal, `@import`, `javascript:`, legacy CSS
expressions, and unsupported theme tokens are rejected.

Scope custom rules with the theme ID:

```css
html[data-theme-id="my-theme"] .panel {
  border-color: var(--line);
}
```

Pi Web's bundled styles use CSS Modules, but semantic classes such as `.panel`,
`.button`, and `.session-header` are retained as a stable theme API. Theme CSS
must target those semantic classes rather than generated class names. Theme
packs may change colors, typography, radii, and surface treatment, but must not
change shell widths, control dimensions, positioning, or visibility.

If a custom theme makes the interface unusable, open:

```text
http://127.0.0.1:8787/settings?safe-theme=1
```

Safe mode loads the built-in theme without uploaded CSS or backgrounds.

## 简体中文

本目录包含两套独立实现、可直接安装的主题：Geist Workbench 和 Material 3
Workbench。源码位于各自目录，可安装 ZIP 位于 `dist/`。

两套主题都使用 `schemaVersion: 2`，在同一份 `theme.json` 中提供
`schemes.light` 和 `schemes.dark`。选择跟随系统时会切换配色方案，但不会更换
主题 ID。

主题包可直接包含 `theme.json`，也可以多包一层同名目录。推荐同时提供
`theme.css` 和可选的 `assets/`。旧版 `schemaVersion: 1` 单模式主题仍然兼容。

主题 ID 必须使用小写 kebab-case。ZIP 最大 8 MB，解压后最大 20 MB，最多
240 个文件。允许 CSS、常见位图和字体；脚本、HTML、SVG、路径穿越、
`@import`、`javascript:`、旧式 CSS 表达式和未支持的 token 会被拒绝。

自定义 CSS 应使用 `html[data-theme-id="<主题 ID>"]` 限定作用范围，不要隐藏
登录、发送、停止、保存或确认等关键操作。

Pi Web 内置样式使用 CSS Modules，但 `.panel`、`.button`、
`.session-header` 等语义类会作为稳定的主题接口保留。主题 CSS 不应引用构建时
生成的哈希类名。主题包可以调整颜色、字体、圆角和表面质感，但不得改动侧栏
宽度、控件尺寸、定位或可见性。

如果主题导致界面无法使用，请访问：

```text
http://127.0.0.1:8787/settings?safe-theme=1
```

安全模式会跳过上传的 CSS 和背景，恢复到内置主题。
