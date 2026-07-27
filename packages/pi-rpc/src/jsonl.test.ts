import { describe, expect, it } from "vitest";
import { LfJsonlDecoder } from "./jsonl.js";

function harness(maxLineBytes = 1024) {
  const values: unknown[] = [];
  const errors: Array<{ error: Error; raw: string }> = [];
  const decoder = new LfJsonlDecoder({
    maxLineBytes,
    onValue: (value) => values.push(value),
    onError: (error, raw) => errors.push({ error, raw })
  });
  return { decoder, values, errors };
}

describe("LfJsonlDecoder", () => {
  it("frames partial chunks only on LF", () => {
    const { decoder, values, errors } = harness();
    decoder.push(Buffer.from('{"type":"mes'));
    decoder.push(Buffer.from('sage","text":"ok"}\n{"n":2'));
    decoder.push(Buffer.from("}\r\n"));
    decoder.end();
    expect(values).toEqual([
      { type: "message", text: "ok" },
      { n: 2 }
    ]);
    expect(errors).toEqual([]);
  });

  it("preserves Unicode line and paragraph separators inside JSON", () => {
    const { decoder, values } = harness();
    decoder.push(Buffer.from(`${JSON.stringify({ text: "a\u2028b\u2029c" })}\n`));
    decoder.end();
    expect(values).toEqual([{ text: "a\u2028b\u2029c" }]);
  });

  it("reports malformed and incomplete records without emitting values", () => {
    const { decoder, values, errors } = harness();
    decoder.push(Buffer.from("{bad}\n"));
    decoder.push(Buffer.from('{"partial":true'));
    decoder.end();
    expect(values).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it("rejects overlong records", () => {
    const { decoder, errors } = harness(16);
    decoder.push(Buffer.from(`{"text":"${"x".repeat(40)}"}`));
    expect(errors[0]?.error.message).toContain("exceeds");
  });
});
