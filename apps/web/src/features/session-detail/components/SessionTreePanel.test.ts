import type { SessionTreeSnapshot } from "@pi-web/protocol";
import { describe, expect, it } from "vitest";
import {
  buildSessionTreeRows,
  hasSessionTreeBranches
} from "./SessionTreePanel";

describe("buildSessionTreeRows", () => {
  it("marks the active branch, current leaf, and branch points", () => {
    const tree: SessionTreeSnapshot = {
      nodes: [
        {
          id: "root",
          parentId: null,
          type: "message",
          role: "user",
          summary: "start",
          timestamp: null
        },
        {
          id: "assistant",
          parentId: "root",
          type: "message",
          role: "assistant",
          summary: "answer",
          timestamp: null
        },
        {
          id: "active",
          parentId: "assistant",
          type: "message",
          role: "user",
          summary: "active prompt",
          timestamp: null
        },
        {
          id: "alternate",
          parentId: "assistant",
          type: "message",
          role: "user",
          summary: "alternate prompt",
          timestamp: null
        }
      ],
      leafId: "active",
      activePathIds: ["root", "assistant", "active"],
      truncated: false
    };

    const rows = buildSessionTreeRows(tree);

    expect(rows.find((row) => row.node.id === "assistant")).toMatchObject({
      branchPoint: true,
      active: true
    });
    expect(rows.find((row) => row.node.id === "active")).toMatchObject({
      current: true,
      active: true,
      depth: 1
    });
    expect(rows.find((row) => row.node.id === "alternate")).toMatchObject({
      current: false,
      active: false,
      depth: 1
    });
    expect(hasSessionTreeBranches(tree)).toBe(true);
  });

  it("does not promote a linear history as a branch", () => {
    expect(
      hasSessionTreeBranches({
        nodes: [
          {
            id: "root",
            parentId: null,
            type: "message",
            role: "user",
            summary: "start",
            timestamp: null
          },
          {
            id: "answer",
            parentId: "root",
            type: "message",
            role: "assistant",
            summary: "answer",
            timestamp: null
          }
        ],
        leafId: "answer",
        activePathIds: ["root", "answer"],
        truncated: false
      })
    ).toBe(false);
  });
});
