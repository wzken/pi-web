import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clearSessionCache, readPiSession } from "./index.js";

const sessionStatOverrides = vi.hoisted(
  () => new Map<string, { size: number; mtimeMs: number }>()
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (path: Parameters<typeof actual.stat>[0]) => {
      const result = await actual.stat(path);
      const override = sessionStatOverrides.get(String(path));
      return override ? Object.assign(result, override) : result;
    }
  };
});

async function writeSession(records: unknown[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-session-"));
  const file = join(directory, "session.jsonl");
  await writeFile(
    file,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
  return file;
}

describe("Pi session reader", () => {
  it("follows the active parent chain and aggregates billed usage across branches", async () => {
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
      {
        type: "message",
        id: "orphan",
        parentId: "a",
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "old branch" },
            { type: "toolCall", name: "search", arguments: {} }
          ],
          usage: {
            input: 20,
            output: 5,
            cacheRead: 3,
            cost: { total: 0.02 }
          }
        }
      },
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
      inputTokens: 30,
      outputTokens: 9,
      cachedTokens: 5,
      reportedCost: 0.03,
      costStatus: "reported",
      toolCalls: 2
    });
  });

  it("projects Pi compaction context and counts summary usage once", async () => {
    const now = new Date().toISOString();
    const file = await writeSession([
      { type: "session", version: 3, id: "session", timestamp: now, cwd: "/" },
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp: now,
        message: {
          role: "assistant",
          content: "old",
          usage: { input: 3, inputTokens: 300, output: 2 }
        }
      },
      {
        type: "message",
        id: "b",
        parentId: "a",
        timestamp: now,
        message: { role: "user", content: "kept" }
      },
      {
        type: "compaction",
        id: "c",
        parentId: "b",
        timestamp: now,
        firstKeptEntryId: "b",
        summary: "Earlier work",
        tokensBefore: 500,
        usage: {
          input: 7,
          inputTokens: 700,
          output: 4,
          cacheRead: 2,
          cachedTokens: 200,
          cost: { total: 0.05 }
        }
      },
      {
        type: "message",
        id: "d",
        parentId: "c",
        timestamp: now,
        message: { role: "assistant", content: "new" }
      }
    ]);

    const result = await readPiSession(file);

    expect(result.messages.map((message) => message.role)).toEqual([
      "compactionSummary",
      "user",
      "assistant"
    ]);
    expect(result.messages[0]?.summary).toBe("Earlier work");
    expect(result.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 6,
      cachedTokens: 2,
      reportedCost: 0.05
    });

    result.usage.inputTokens = 999;
    const cachedResult = await readPiSession(file);
    expect(cachedResult.usage.inputTokens).toBe(10);
    expect(cachedResult.usage).not.toBe(result.usage);
  });

  it("evicts the least recently used sessions when the byte budget is exceeded", async () => {
    clearSessionCache();
    const now = new Date().toISOString();
    const records = [
      { type: "session", version: 3, id: "session", timestamp: now, cwd: "/" },
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp: now,
        message: { role: "user", content: "hello" }
      }
    ];
    const files = await Promise.all([
      writeSession(records),
      writeSession(records),
      writeSession(records)
    ]);
    for (const file of files) {
      sessionStatOverrides.set(file, {
        size: 24 * 1024 * 1024,
        mtimeMs: 1
      });
    }

    try {
      await readPiSession(files[0]!);
      await readPiSession(files[1]!);
      await readPiSession(files[0]!);
      await readPiSession(files[2]!);

      await writeFile(files[0]!, "{broken\n");
      await writeFile(files[1]!, "{broken\n");

      await expect(readPiSession(files[0]!)).resolves.toMatchObject({
        messages: [{ role: "user", content: "hello" }]
      });
      await expect(readPiSession(files[1]!)).rejects.toThrow();
    } finally {
      clearSessionCache();
      for (const file of files) sessionStatOverrides.delete(file);
    }
  });

  it.each([
    {
      name: "missing header",
      records: [
        {
          type: "message",
          id: "a",
          parentId: null,
          message: { role: "user", content: "hello" }
        }
      ],
      message: "header is missing"
    },
    {
      name: "unsupported old version",
      records: [{ type: "session", version: 2, id: "session", cwd: "/" }],
      message: "Unsupported Pi session version: 2"
    },
    {
      name: "unsupported future version",
      records: [{ type: "session", version: 4, id: "session", cwd: "/" }],
      message: "Unsupported Pi session version: 4"
    }
  ])("rejects $name instead of guessing", async ({ records, message }) => {
    const file = await writeSession(records);
    await expect(readPiSession(file)).rejects.toThrow(message);
  });

  it("rejects a malformed middle record instead of returning partial history", async () => {
    const now = new Date().toISOString();
    const file = await writeSession([
      { type: "session", version: 3, id: "session", timestamp: now, cwd: "/" },
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp: now,
        message: { role: "user", content: "hello" }
      }
    ]);
    await writeFile(
      file,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session",
          timestamp: now,
          cwd: "/"
        }),
        "{broken",
        JSON.stringify({
          type: "message",
          id: "a",
          parentId: null,
          timestamp: now,
          message: { role: "user", content: "hello" }
        }),
        ""
      ].join("\n")
    );
    clearSessionCache(file);

    await expect(readPiSession(file)).rejects.toThrow();
  });

  it("rejects a pagination cursor after the Pi session changes", async () => {
    const now = new Date().toISOString();
    const records = [
      { type: "session", version: 3, id: "session", timestamp: now, cwd: "/" },
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp: now,
        message: { role: "user", content: "one" }
      },
      {
        type: "message",
        id: "b",
        parentId: "a",
        timestamp: now,
        message: { role: "assistant", content: "two" }
      }
    ];
    const file = await writeSession(records);
    const first = await readPiSession(file, { limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    await writeFile(
      file,
      `${[...records, {
        type: "message",
        id: "c",
        parentId: "b",
        timestamp: now,
        message: { role: "user", content: "three" }
      }].map((record) => JSON.stringify(record)).join("\n")}\n`
    );
    clearSessionCache(file);

    await expect(
      readPiSession(file, { limit: 1, cursor: first.nextCursor })
    ).rejects.toThrow("Pi session changed");
  });
});
