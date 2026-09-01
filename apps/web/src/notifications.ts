const preferencesKey = "pi-web:notification-preferences";

export interface NotificationPreferences {
  sound: boolean;
}

const defaultPreferences: NotificationPreferences = {
  sound: false
};

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(preferencesKey) ?? "null"
    ) as Partial<NotificationPreferences> | null;
    return { sound: value?.sound === true };
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
    // Browsers may block audio before a user gesture; the inbox still updates.
  }
}
