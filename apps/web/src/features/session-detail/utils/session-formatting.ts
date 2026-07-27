export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function safeFileName(value: string): string {
  return (
    value
      .replace(new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]', "g"), "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "pi-session"
  );
}

export function formatElapsed(
  startedAt: string,
  endedAt: string | null,
  now: number
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
