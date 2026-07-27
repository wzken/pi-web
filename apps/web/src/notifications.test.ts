import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionUnread,
  getUnreadSessionIds,
  loadNotificationPreferences,
  markSessionUnread,
  saveNotificationPreferences
} from "./notifications";

describe("notification browser state", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn()
    });
  });

  it("persists opt-in preferences with safe defaults", () => {
    expect(loadNotificationPreferences()).toEqual({
      browser: false,
      sound: false
    });
    saveNotificationPreferences({ browser: true, sound: false });
    expect(loadNotificationPreferences()).toEqual({
      browser: true,
      sound: false
    });
  });

  it("marks and clears unread sessions without duplicates", () => {
    markSessionUnread("one");
    markSessionUnread("one");
    markSessionUnread("two");
    expect([...getUnreadSessionIds()]).toEqual(["one", "two"]);

    clearSessionUnread("one");
    expect([...getUnreadSessionIds()]).toEqual(["two"]);
  });
});
