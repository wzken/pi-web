import type {
  ExtensionUiResponse,
  PendingExtensionInteraction,
  RealtimeEvent
} from "@pi-web/protocol";
import { nowIso, PiWebError } from "@pi-web/shared";
import { TransientMutationDeduper } from "./mutation-deduper.js";
import { fingerprintMutationPayload } from "./mutation-fingerprint.js";
import { NotificationCenter } from "./notification-center.js";
import type { WorkerRuntime } from "./runtime-registry.js";
import { SessionStore } from "./session-store.js";

export class ExtensionInteractions {
  readonly #mutations = new TransientMutationDeduper();

  constructor(
    private readonly sessions: SessionStore,
    private readonly notifications: NotificationCenter,
    private readonly isCurrent: (
      sessionId: string,
      runtime: WorkerRuntime
    ) => boolean,
    private readonly emit: (
      sessionId: string,
      type: string,
      payload: unknown
    ) => RealtimeEvent
  ) {}

  async respond(
    sessionId: string,
    runtime: WorkerRuntime,
    response: ExtensionUiResponse
  ): Promise<{ accepted: true }> {
    const fingerprint = fingerprintMutationPayload(response);
    const mutationId = response.mutationId;
    const operation = async () => {
      const interaction = runtime.pendingInteractions.get(response.interactionId);
      if (
        !interaction ||
        runtime.respondingInteractions.has(response.interactionId)
      ) {
        throw new PiWebError(
          "EXTENSION_UI_NOT_PENDING",
          "The extension interaction is no longer pending",
          409
        );
      }
      if (interaction.method === "confirm") {
        if (response.cancelled !== true && response.confirmed === undefined) {
          throw new PiWebError(
            "INVALID_EXTENSION_UI_RESPONSE",
            "A confirmation interaction requires confirmed or cancelled",
            400
          );
        }
      } else if (response.cancelled !== true && response.value === undefined) {
        throw new PiWebError(
          "INVALID_EXTENSION_UI_RESPONSE",
          "This extension interaction requires a value or cancellation",
          400
        );
      }
      runtime.respondingInteractions.add(response.interactionId);
      try {
        await runtime.worker.sendExtensionUiResponse({
          id: response.interactionId,
          ...(response.cancelled === true
            ? { cancelled: true }
            : interaction.method === "confirm"
              ? { confirmed: response.confirmed === true }
              : { value: response.value ?? "" })
        });
        this.#remove(runtime, response.interactionId);
        this.notifications.resolveExtension(sessionId, response.interactionId);
        this.emit(sessionId, "extension_ui.resolved", {
          interactionId: response.interactionId
        });
        return { accepted: true as const };
      } finally {
        runtime.respondingInteractions.delete(response.interactionId);
      }
    };
    return mutationId
      ? await this.#mutations.run(
          `extension-ui:${sessionId}:${mutationId}`,
          fingerprint,
          operation
        )
      : await operation();
  }

  handleRequest(
    sessionId: string,
    runtime: WorkerRuntime,
    event: Record<string, unknown>
  ): void {
    const interactionId = typeof event.id === "string" ? event.id : null;
    const method = typeof event.method === "string" ? event.method : "";
    if (!interactionId) {
      this.emit(sessionId, "pi.protocol_error", {
        message: "Extension UI request is missing an id"
      });
      return;
    }
    if (["select", "confirm", "input", "editor"].includes(method)) {
      const interaction: PendingExtensionInteraction = {
        id: interactionId,
        method: method as PendingExtensionInteraction["method"],
        title: boundedString(event.title, "Extension request"),
        message: nullableString(event.message),
        options: Array.isArray(event.options)
          ? event.options
              .filter((option): option is string => typeof option === "string")
              .slice(0, 100)
              .map((option) => option.slice(0, 2_000))
          : [],
        placeholder: nullableString(event.placeholder),
        prefill: nullableString(event.prefill, 200_000),
        timeoutMs:
          typeof event.timeout === "number" &&
          Number.isFinite(event.timeout) &&
          event.timeout > 0
            ? Math.min(event.timeout, 86_400_000)
            : null,
        createdAt: nowIso()
      };
      runtime.pendingInteractions.set(interactionId, interaction);
      if (interaction.timeoutMs !== null) {
        const timer = setTimeout(() => {
          void this.#expire(sessionId, runtime, interactionId);
        }, interaction.timeoutMs);
        timer.unref();
        runtime.interactionTimers.set(interactionId, timer);
      }
      this.emit(sessionId, "extension_ui.pending", interaction);
      this.notifications.extensionPending(
        this.sessions.get(sessionId),
        interaction
      );
      return;
    }
    this.emit(
      sessionId,
      "extension_ui.notification",
      projectNotice(event)
    );
  }

  clear(sessionId: string, runtime: WorkerRuntime): void {
    for (const interactionId of runtime.pendingInteractions.keys()) {
      this.notifications.resolveExtension(sessionId, interactionId);
    }
    for (const timer of runtime.interactionTimers.values()) clearTimeout(timer);
    runtime.interactionTimers.clear();
    runtime.pendingInteractions.clear();
    runtime.respondingInteractions.clear();
  }

  async #expire(
    sessionId: string,
    runtime: WorkerRuntime,
    interactionId: string
  ): Promise<void> {
    if (!this.isCurrent(sessionId, runtime)) return;
    if (
      !runtime.pendingInteractions.has(interactionId) ||
      runtime.respondingInteractions.has(interactionId)
    ) {
      return;
    }
    runtime.respondingInteractions.add(interactionId);
    try {
      await runtime.worker.sendExtensionUiResponse({
        id: interactionId,
        cancelled: true
      });
    } catch {
      return;
    } finally {
      runtime.respondingInteractions.delete(interactionId);
    }
    if (
      !this.isCurrent(sessionId, runtime) ||
      !runtime.pendingInteractions.has(interactionId)
    ) {
      return;
    }
    this.#remove(runtime, interactionId);
    this.notifications.resolveExtension(sessionId, interactionId);
    this.emit(sessionId, "extension_ui.expired", { interactionId });
  }

  #remove(runtime: WorkerRuntime, interactionId: string): void {
    const timer = runtime.interactionTimers.get(interactionId);
    if (timer) clearTimeout(timer);
    runtime.interactionTimers.delete(interactionId);
    runtime.pendingInteractions.delete(interactionId);
  }
}

function boundedString(
  value: unknown,
  fallback: string,
  limit = 2_000
): string {
  return typeof value === "string" && value.trim()
    ? value.slice(0, limit)
    : fallback;
}

function nullableString(value: unknown, limit = 2_000): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

function projectNotice(event: Record<string, unknown>): Record<string, unknown> {
  const method = typeof event.method === "string" ? event.method : "unknown";
  if (method === "notify") {
    return {
      method,
      message: boundedString(event.message, "Extension notification"),
      notifyType: ["info", "warning", "error"].includes(String(event.notifyType))
        ? event.notifyType
        : "info"
    };
  }
  if (method === "setStatus") {
    return {
      method,
      statusKey: nullableString(event.statusKey),
      statusText: nullableString(event.statusText)
    };
  }
  if (method === "setWidget") {
    return {
      method,
      widgetKey: nullableString(event.widgetKey),
      widgetLines: Array.isArray(event.widgetLines)
        ? event.widgetLines
            .filter((line): line is string => typeof line === "string")
            .slice(0, 100)
            .map((line) => line.slice(0, 2_000))
        : [],
      widgetPlacement:
        event.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor"
    };
  }
  if (method === "setTitle") {
    return { method, title: nullableString(event.title) };
  }
  if (method === "set_editor_text") {
    return { method, text: nullableString(event.text, 200_000) };
  }
  return { method };
}
