import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@pi-web/protocol";
import { syncBrowserSubscription } from "./app.js";

describe("browser session synchronization", () => {
  it("forces a fresh snapshot after the session daemon reconnects", async () => {
    const snapshot = {
      session: {
        id: "session-1",
        status: "interrupted"
      },
      sequence: 14
    } as SessionSnapshot;
    const client = {
      request: vi.fn().mockResolvedValue(snapshot)
    };
    const messages: string[] = [];
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: (message: string) => messages.push(message)
    };

    const sequence = await syncBrowserSubscription(
      socket,
      client,
      "session-1",
      14,
      true
    );

    expect(client.request).toHaveBeenCalledWith("sessions.snapshot", {
      id: "session-1"
    });
    expect(sequence).toBe(14);
    expect(JSON.parse(messages[0]!)).toMatchObject({
      type: "sync",
      sessionId: "session-1",
      mode: "snapshot",
      snapshot: {
        sequence: 14,
        session: { status: "interrupted" }
      }
    });
  });

  it("uses incremental synchronization for a normal subscription", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        mode: "incremental",
        events: [],
        sequence: 9
      })
    };
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn()
    };

    expect(
      await syncBrowserSubscription(socket, client, "session-1", 7)
    ).toBe(9);
    expect(client.request).toHaveBeenCalledWith("sessions.sync", {
      id: "session-1",
      afterSequence: 7
    });
  });
});
