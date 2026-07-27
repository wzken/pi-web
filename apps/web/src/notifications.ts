const preferencesKey = "pi-web:notification-preferences";
const unreadKey = "pi-web:unread-sessions";
export const notificationStateEvent = "pi-web:notification-state";

export interface NotificationPreferences {
  browser: boolean;
  sound: boolean;
}

const defaultPreferences: NotificationPreferences = {
  browser: false,
  sound: false
};

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(preferencesKey) ?? "null"
    ) as Partial<NotificationPreferences> | null;
    return {
      browser: value?.browser === true,
      sound: value?.sound === true
    };
  } catch {
    return defaultPreferences;
  }
}

export function saveNotificationPreferences(
  preferences: NotificationPreferences
): void {
  try {
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  } catch {
    // Preferences remain usable for this page load when storage is unavailable.
  }
  window.dispatchEvent(new Event(notificationStateEvent));
}

export function browserNotificationsAvailable(): boolean {
  return typeof Notification !== "undefined";
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!browserNotificationsAvailable()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  return await Notification.requestPermission();
}

export function notifySessionCompletion({
  sessionId,
  displayName,
  failed = false
}: {
  sessionId: string;
  displayName: string;
  failed?: boolean;
}): void {
  if (
    document.visibilityState === "visible" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  ) {
    return;
  }
  markSessionUnread(sessionId);
  const preferences = loadNotificationPreferences();
  if (preferences.sound) playCompletionSound(failed);
  if (
    preferences.browser &&
    browserNotificationsAvailable() &&
    Notification.permission === "granted"
  ) {
    const notification = new Notification(
      failed ? t("Pi 会话需要处理") : t("Pi 会话已完成"),
      {
        body: displayName,
        tag: `pi-web-session-${sessionId}`
      }
    );
    notification.onclick = () => {
      window.focus();
      window.location.assign(`/sessions/${encodeURIComponent(sessionId)}`);
      notification.close();
    };
  }
}

export function playCompletionSound(failed = false): void {
  const AudioContextConstructor =
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      failed ? 240 : 660,
      context.currentTime
    );
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.addEventListener("ended", () => void context.close(), {
      once: true
    });
  } catch {
    // Browsers may block audio before a user gesture; notifications still work.
  }
}

export function getUnreadSessionIds(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(unreadKey) ?? "[]") as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : []
    );
  } catch {
    return new Set();
  }
}

export function markSessionUnread(sessionId: string): void {
  const unread = getUnreadSessionIds();
  unread.add(sessionId);
  writeUnread(unread);
}

export function clearSessionUnread(sessionId: string): void {
  const unread = getUnreadSessionIds();
  if (!unread.delete(sessionId)) return;
  writeUnread(unread);
}

function writeUnread(unread: Set<string>): void {
  try {
    localStorage.setItem(unreadKey, JSON.stringify([...unread]));
  } catch {
    // Unread markers are best-effort browser state.
  }
  window.dispatchEvent(new Event(notificationStateEvent));
}
import { t } from "./i18n";
