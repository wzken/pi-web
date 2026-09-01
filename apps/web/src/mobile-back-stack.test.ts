import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMobileDismissersForTests,
  dismissTopMobileLayer,
  registerMobileDismiss
} from "./mobile-back-stack";

describe("mobile back stack", () => {
  beforeEach(clearMobileDismissersForTests);

  it("dismisses the most recently registered layer first", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerMobileDismiss(first);
    registerMobileDismiss(second);

    expect(dismissTopMobileLayer()).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("removes an unmounted layer and reports an empty stack", () => {
    const dismiss = vi.fn();
    const unregister = registerMobileDismiss(dismiss);
    unregister();

    expect(dismissTopMobileLayer()).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });
});
