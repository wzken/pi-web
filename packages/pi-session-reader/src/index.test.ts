import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPiSession } from "./index.js";

describe("Pi session reader", () => {
  it("follows the active parent chain and aggregates reported usage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-session-"));
    const file = join(directory, "session.jsonl");
    const records = [
      { type: "session", version: 3, id: "session", timestamp: new Date().toISOString(), cwd: directory },
      { type: "message", id: "a", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: "hello" } },
      {
        type: "message",
        id: "b",
        parentId: "a",
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hi" },
            { type: "toolCall", name: "read", arguments: {} }
          ],
          usage: { input: 10, output: 4, cacheRead: 2, cost: { total: 0.01 } }
        }
      },
      { type: "message", id: "orphan", parentId: "a", timestamp: new Date().toISOString(), message: { role: "assistant", content: "old branch" } },
      { type: "message", id: "c", parentId: "b", timestamp: new Date().toISOString(), message: { role: "user", content: "next" } }
    ];
    await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    const result = await readPiSession(file);
    expect(result.messages.map((message) => message.content)).toEqual([
      "hello",
      [
        { type: "text", text: "hi" },
        { type: "toolCall", name: "read", arguments: {} }
      ],
      "next"
    ]);
    expect(result.tree.nodes.map((node) => node.id)).toEqual([
      "a",
      "b",
      "orphan",
      "c"
    ]);
    expect(result.tree.activePathIds).toEqual(["a", "b", "c"]);
    expect(result.tree.leafId).toBe("c");
    expect(
      result.tree.nodes.find((node) => node.id === "orphan")?.summary
    ).toBe("old branch");
    expect(result.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      cachedTokens: 2,
      reportedCost: 0.01,
      costStatus: "reported",
      toolCalls: 1
    });
  });
});
