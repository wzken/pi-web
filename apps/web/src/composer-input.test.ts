import { describe, expect, it } from "vitest";
import {
  draftAfterSuccessfulSubmit,
  resolveComposerSubmissionRoute,
  shouldSubmitComposerInput
} from "./composer-input";

describe("composer keyboard submission", () => {
  it("submits a plain Enter key", () => {
    expect(
      shouldSubmitComposerInput({
        key: "Enter",
        shiftKey: false,
        isComposing: false
      })
    ).toBe(true);
  });

  it("does not submit multiline or IME confirmation keys", () => {
    expect(
      shouldSubmitComposerInput({
        key: "Enter",
        shiftKey: true,
        isComposing: false
      })
    ).toBe(false);
    expect(
      shouldSubmitComposerInput({
        key: "Enter",
        shiftKey: false,
        isComposing: true
      })
    ).toBe(false);
    expect(
      shouldSubmitComposerInput({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 229
      })
    ).toBe(false);
  });

  it("ignores keys other than Enter", () => {
    expect(
      shouldSubmitComposerInput({
        key: "a",
        shiftKey: false,
        isComposing: false
      })
    ).toBe(false);
  });
});

describe("composer draft completion", () => {
  it("clears the exact draft that was submitted", () => {
    expect(draftAfterSuccessfulSubmit("sent", "sent")).toBe("");
  });

  it("preserves text entered while the request was pending", () => {
    expect(draftAfterSuccessfulSubmit("next task", "sent")).toBe("next task");
  });
});

describe("composer submission routing", () => {
  it("uses Pi steer by default while a turn is running", () => {
    expect(resolveComposerSubmissionRoute("running", "steer")).toEqual({
      path: "messages",
      operation: "sessions.prompt",
      behavior: "steer"
    });
  });

  it("uses a one-time follow-up override without changing the selected mode", () => {
    expect(
      resolveComposerSubmissionRoute("running", "steer", true)
    ).toEqual({
      path: "messages",
      operation: "sessions.prompt",
      behavior: "follow_up"
    });
    expect(resolveComposerSubmissionRoute("running", "steer")).toEqual({
      path: "messages",
      operation: "sessions.prompt",
      behavior: "steer"
    });
  });

  it("uses an ordinary prompt for a waiting Pi session", () => {
    expect(resolveComposerSubmissionRoute("waiting", "follow_up", true)).toEqual({
      path: "messages",
      operation: "sessions.prompt",
      behavior: "prompt"
    });
  });

  it.each(["closed", "failed", "interrupted"] as const)(
    "resumes %s with the submitted prompt",
    (status) => {
      expect(resolveComposerSubmissionRoute(status, "steer")).toEqual({
        path: "resume",
        operation: "sessions.resume"
      });
    }
  );

  it.each(["starting", "stopping"] as const)(
    "does not submit while %s",
    (status) => {
      expect(resolveComposerSubmissionRoute(status, "steer")).toBeNull();
    }
  );
});
