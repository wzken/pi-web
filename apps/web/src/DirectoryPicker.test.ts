import { describe, expect, it } from "vitest";
import { pathBelongsToRoot } from "./DirectoryPicker";

describe("pathBelongsToRoot", () => {
  it("matches a root or one of its descendants", () => {
    expect(pathBelongsToRoot("C:\\work\\pi-web", "C:\\work")).toBe(true);
    expect(pathBelongsToRoot("/srv/pi-web", "/srv")).toBe(true);
  });

  it("does not confuse a shared prefix with a child path", () => {
    expect(pathBelongsToRoot("C:\\workspace-old", "C:\\workspace")).toBe(false);
    expect(pathBelongsToRoot("/srv-backup", "/srv")).toBe(false);
  });
});
