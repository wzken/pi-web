import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("highlights fenced code without rendering raw HTML", () => {
    const markup = renderToStaticMarkup(
      <Markdown>{`\`\`\`ts\nconst answer: number = 42;\n\`\`\`\n<script>alert(1)</script>`}</Markdown>
    );

    expect(markup).toContain("hljs");
    expect(markup).toContain("hljs-keyword");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("alert(1)");
  });
});
