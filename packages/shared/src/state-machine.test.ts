import { describe, expect, it } from "vitest";
import { canTransition } from "./state-machine.js";

describe("session state machine", () => {
  it("keeps waiting distinct and allows another turn", () => {
    expect(canTransition("starting", "waiting")).toBe(true);
    expect(canTransition("waiting", "running")).toBe(true);
    expect(canTransition("running", "closed")).toBe(false);
    expect(canTransition("stopping", "waiting")).toBe(true);
  });
});
