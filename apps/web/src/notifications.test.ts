import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  saveNotificationPreferences
} from "./notifications";


describe("notification browser preferences", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
  });

  it("persists only the local completion-sound preference", () => {
    expect(loadNotificationPreferences()).toEqual({ sound: false });
    saveNotificationPreferences({ sound: true });
    expect(loadNotificationPreferences()).toEqual({ sound: true });
  });

  it("ignores the retired browser-notification flag", () => {
    values.set(
      "pi-web:notification-preferences",
      JSON.stringify({ browser: true, sound: false })
    );
    expect(loadNotificationPreferences()).toEqual({ sound: false });
  });
});
