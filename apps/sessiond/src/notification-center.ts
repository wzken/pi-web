import { EventEmitter } from "node:events";
import type {
  NotificationRecord,
  NotificationSummary,
  PendingExtensionInteraction,
  ScheduledJob,
  ScheduledRun,
  SessionRecord
} from "@pi-web/protocol";
import { NotificationStore } from "./notification-store.js";

export class NotificationCenter extends EventEmitter {
  readonly #store: NotificationStore;

  constructor(store: NotificationStore) {
    super();
    this.#store = store;
  }

  extensionPending(
    session: SessionRecord,
    interaction: PendingExtensionInteraction
  ): NotificationRecord {
    return this.#create({
      dedupeKey: extensionInteractionKey(session.id, interaction.id),
      kind: "extension_interaction",
      severity: "warning",
      title: "Pi needs your decision",
      body: session.displayName,
      href: sessionHref(session.id),
      sessionId: session.id,
      requiresAction: true
    });
  }

  resolveExtension(sessionId: string, interactionId: string): void {
    this.#resolve(extensionInteractionKey(sessionId, interactionId));
  }

  sessionSettled(session: SessionRecord): NotificationRecord {
    return this.#create({
      dedupeKey: `session:${session.id}:settled:${session.settledAt ?? session.updatedAt}`,
      kind: "session_settled",
      severity: "success",
      title: "Pi is waiting for instructions",
      body: session.displayName,
      href: sessionHref(session.id),
      sessionId: session.id
    });
  }

  sessionFailed(
    session: SessionRecord,
    incidentKey: string,
    _body: string
  ): NotificationRecord {
    return this.#create({
      dedupeKey: `session:${session.id}:failed:${incidentKey}`,
      kind: "session_failed",
      severity: "error",
      title: "Pi session needs attention",
      body: session.displayName,
      href: sessionHref(session.id),
      sessionId: session.id,
      requiresAction: true
    });
  }

  scheduleFailed(
    job: ScheduledJob,
    run: ScheduledRun,
    _body: string
  ): NotificationRecord {
    return this.#create({
      dedupeKey: `schedule-run:${run.id}:failed`,
      kind: "schedule_failed",
      severity: "error",
      title: `Scheduled task failed · ${job.name}`,
      body: "Open Pi Web to review the failed scheduled run.",
      href: `/schedules?job=${encodeURIComponent(job.id)}&run=${encodeURIComponent(run.id)}`,
      sessionId: run.sessionId,
      jobId: job.id,
      runId: run.id,
      requiresAction: true
    });
  }

  list(limit = 100): NotificationSummary {
    return this.#store.list(limit);
  }

  markRead(id: string): NotificationRecord {
    return this.#publish(this.#store.markRead(id));
  }

  markAllRead(): NotificationSummary {
    const summary = this.#store.markAllRead();
    this.emit("refresh");
    return summary;
  }

  markSessionRead(sessionId: string): NotificationSummary {
    const summary = this.#store.markSessionRead(sessionId);
    this.emit("refresh");
    return summary;
  }

  dismiss(id: string): NotificationRecord {
    return this.#publish(this.#store.dismiss(id));
  }

  #publish(notification: NotificationRecord): NotificationRecord {
    this.emit("notification", notification);
    return notification;
  }

  #create(input: Parameters<NotificationStore["create"]>[0]): NotificationRecord {
    const result = this.#store.create(input);
    if (result.created) this.#publish(result.notification);
    return result.notification;
  }

  #resolve(dedupeKey: string): void {
    const notification = this.#store.resolve(dedupeKey);
    if (notification) this.#publish(notification);
  }
}

export function extensionInteractionKey(
  sessionId: string,
  interactionId: string
): string {
  return `extension:${sessionId}:${interactionId}`;
}

function sessionHref(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}
