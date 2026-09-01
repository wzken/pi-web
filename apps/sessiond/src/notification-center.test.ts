import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SessionDatabase } from "./database.js";
import {
  extensionInteractionKey,
  NotificationCenter
} from "./notification-center.js";

describe("NotificationCenter", () => {
  it("deduplicates lifecycle notifications and resolves extension attention", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-web-notification-center-"));
    const db = new SessionDatabase(join(directory, "test.sqlite"));
    const center = new NotificationCenter(db.notifications);
    const emitted = vi.fn();
    center.on("notification", emitted);
    const session = db.sessions.create({
      cwd: directory,
      displayName: "Private session name",
      createdBy: "web"
    });

    const interaction = {
      id: "interaction-1",
      method: "confirm" as const,
      title: "Allow secret operation?",
      message: "This secret explanation must not appear on the lock screen.",
      options: [],
      placeholder: null,
      prefill: null,
      timeoutMs: null,
      createdAt: new Date().toISOString()
    };
    const first = center.extensionPending(session, interaction);
    const duplicate = center.extensionPending(session, interaction);

    expect(duplicate.id).toBe(first.id);
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      kind: "extension_interaction",
      title: "Pi needs your decision",
      body: "Private session name",
      requiresAction: true
    });
    expect(JSON.stringify(first)).not.toContain("secret explanation");
    expect(
      db.db
        .prepare("SELECT dedupe_key FROM notifications WHERE id = ?")
        .get(first.id)
    ).toEqual({ dedupe_key: extensionInteractionKey(session.id, interaction.id) });

    center.resolveExtension(session.id, interaction.id);
    expect(center.list()).toMatchObject({
      attentionCount: 0,
      notifications: [{ id: first.id, resolvedAt: expect.any(String) }]
    });
    expect(emitted).toHaveBeenCalledTimes(2);

    const settledSession = db.sessions.update(session.id, {
      status: "waiting",
      settledAt: "2026-08-12T05:00:00.000Z"
    });
    const settled = center.sessionSettled(settledSession);
    expect(center.sessionSettled(settledSession).id).toBe(settled.id);
    expect(emitted).toHaveBeenCalledTimes(3);
    db.close();
  });
});
