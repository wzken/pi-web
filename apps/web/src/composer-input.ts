import type { SessionStatus } from "@pi-web/protocol";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export function shouldSubmitComposerInput({
  key,
  shiftKey,
  isComposing,
  keyCode
}: ComposerKeyInput): boolean {
  return (
    key === "Enter" &&
    !shiftKey &&
    !isComposing &&
    keyCode !== 229
  );
}

export function draftAfterSuccessfulSubmit(
  currentDraft: string,
  submittedDraft: string
): string {
  return currentDraft === submittedDraft ? "" : currentDraft;
}

export type RunningComposerMode = "steer" | "follow_up";

export type ComposerSubmissionRoute =
  | {
      path: "messages";
      operation: "sessions.prompt";
      behavior: "prompt" | RunningComposerMode;
    }
  | {
      path: "resume";
      operation: "sessions.resume";
    };

export function resolveComposerSubmissionRoute(
  status: SessionStatus,
  runningMode: RunningComposerMode,
  oneTimeFollowUp = false
): ComposerSubmissionRoute | null {
  switch (status) {
    case "waiting":
      return {
        path: "messages",
        operation: "sessions.prompt",
        behavior: "prompt"
      };
    case "running":
      return {
        path: "messages",
        operation: "sessions.prompt",
        behavior: oneTimeFollowUp ? "follow_up" : runningMode
      };
    case "closed":
    case "failed":
    case "interrupted":
      return {
        path: "resume",
        operation: "sessions.resume"
      };
    case "starting":
    case "stopping":
      return null;
  }
}
