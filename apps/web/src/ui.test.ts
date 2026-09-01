import { describe, expect, it } from "vitest";
import { ui } from "./ui";

describe("ui", () => {
  it("retains semantic theme hooks", () => {
    const className = ui("button button-primary");

    expect(className.split(" ")).toContain("button");
    expect(className.split(" ")).toContain("button-primary");
    expect(className.split(" ")).toHaveLength(2);
  });

  it("ignores empty conditional values and removes duplicates", () => {
    expect(ui("panel", false, undefined, "panel").split(" ")).toEqual(
      expect.arrayContaining(["panel"])
    );
    expect(ui("panel").split(" ")).toEqual(ui("panel panel").split(" "));
  });
});
