import { describe, expect, it } from "vitest";
import { appendAttachmentReferences } from "./FileAttachments";

describe("attachment prompt references", () => {
  it("appends uploaded workspace paths without hiding the user prompt", () => {
    expect(
      appendAttachmentReferences("检查这些文件", [
        {
          path: ".pi-web/attachments/a-report.pdf",
          name: "report.pdf",
          size: 12
        },
        {
          path: ".pi-web/attachments/b-debug.log",
          name: "debug.log",
          size: 24
        }
      ])
    ).toBe(
      "检查这些文件\n\n@.pi-web/attachments/a-report.pdf\n@.pi-web/attachments/b-debug.log"
    );
  });

  it("supports a file-only prompt", () => {
    expect(
      appendAttachmentReferences("", [
        {
          path: ".pi-web/attachments/readme.md",
          name: "readme.md",
          size: 8
        }
      ])
    ).toBe("@.pi-web/attachments/readme.md");
  });
});
