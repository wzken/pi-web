import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffCard, toolResultDiff, writeCallDiff } from "./DiffCard";

describe("DiffCard", () => {
  it("renders unified and write diffs as red and green lines", () => {
    const patch = "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new";
    const markup = renderToStaticMarkup(<DiffCard text={patch} />);

    expect(markup).toContain("hljs-deletion");
    expect(markup).toContain("hljs-addition");
    expect(
      toolResultDiff(
        { role: "toolResult", toolName: "bash", content: patch },
        patch
      )
    ).toBe(patch);
    expect(
      toolResultDiff(
        {
          role: "toolResult",
          toolName: "edit",
          details: { patch }
        },
        "Successfully replaced 1 block"
      )
    ).toBe(patch);
    expect(
      writeCallDiff({
        type: "toolCall",
        name: "write",
        arguments: { path: "file.ts", content: "const value = 1;" }
      })?.diff
    ).toContain("+const value = 1;");
  });
});
