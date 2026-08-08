import { Search } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  filterCommandItems,
  type CommandPaletteItem
} from "./CommandPalette";
import { BrowserRouter } from "./router";

afterEach(() => vi.unstubAllGlobals());

const commands: CommandPaletteItem[] = [
  {
    id: "dashboard",
    label: "打开总览",
    description: "查看运行状态和用量",
    keywords: "dashboard overview usage",
    to: "/dashboard",
    icon: Search
  },
  {
    id: "session",
    label: "修复文件面板",
    description: "C:/workspace/pi-web · 今天",
    keywords: "session 会话 typescript",
    to: "/sessions/1",
    icon: Search
  }
];

describe("filterCommandItems", () => {
  it("matches normalized labels, descriptions and aliases", () => {
    expect(filterCommandItems(commands, "总览")).toEqual([commands[0]]);
    expect(filterCommandItems(commands, "dashboard usage")).toEqual([
      commands[0]
    ]);
    expect(filterCommandItems(commands, "PI-WEB TYPESCRIPT")).toEqual([
      commands[1]
    ]);
  });

  it("returns every command for an empty query and none for a miss", () => {
    expect(filterCommandItems(commands, "  ")).toEqual(commands);
    expect(filterCommandItems(commands, "不存在")).toEqual([]);
  });
});

describe("CommandPalette", () => {
  it("gives the search combobox an explicit accessible name", () => {
    vi.stubGlobal("window", {
      location: {
        pathname: "/",
        search: ""
      }
    });

    const markup = renderToStaticMarkup(
      createElement(
        BrowserRouter,
        null,
        createElement(CommandPalette, {
          open: true,
          onClose: () => undefined
        })
      )
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="搜索页面或最近会话…"');
  });
});
