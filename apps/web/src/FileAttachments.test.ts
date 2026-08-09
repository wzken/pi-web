import { describe, expect, it } from "vitest";
import {
  appendAttachmentReferences,
  createAttachmentSelectionQueue,
  hasDraggedFiles,
  type PendingFileAttachment
} from "./FileAttachments";
import type { PendingImage } from "./ImageAttachments";

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

describe("attachment drop detection", () => {
  it("only activates for operating-system file drags", () => {
    expect(
      hasDraggedFiles({ types: ["Files"] } as unknown as DataTransfer)
    ).toBe(true);
    expect(
      hasDraggedFiles({ types: ["text/plain"] } as unknown as DataTransfer)
    ).toBe(false);
  });
});

describe("attachment selection queue", () => {
  it("serializes image reads so later selections include earlier results", async () => {
    let images: PendingImage[] = [];
    let files: PendingFileAttachment[] = [];
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const reads: string[] = [];
    const queue = createAttachmentSelectionQueue({
      active: () => true,
      getImages: () => images,
      getFiles: () => files,
      appendImages: async (current, selected) => {
        const name = selected[0]!.name;
        reads.push(name);
        if (name === "first.png") await firstRead;
        return [
          ...current,
          {
            id: name,
            name,
            size: 1,
            type: "image",
            mimeType: "image/png",
            data: "YQ=="
          }
        ];
      },
      appendFiles: (current) => current,
      setImages: (next) => {
        images = next;
      },
      setFiles: (next) => {
        files = next;
      }
    });

    const first = queue.add([
      { name: "first.png", type: "image/png" } as File
    ]);
    await Promise.resolve();
    const second = queue.add([
      { name: "second.png", type: "image/png" } as File
    ]);

    expect(reads).toEqual(["first.png"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(reads).toEqual(["first.png", "second.png"]);
    expect(images.map((image) => image.name)).toEqual([
      "first.png",
      "second.png"
    ]);
  });
});
