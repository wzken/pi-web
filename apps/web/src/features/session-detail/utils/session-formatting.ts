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
