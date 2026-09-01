export function isCacheFresh(
  loadedAt: number | null,
  now: number,
  ttlMs: number
): boolean {
  return (
    loadedAt !== null &&
    Number.isFinite(loadedAt) &&
    now >= loadedAt &&
    now - loadedAt < ttlMs
  );
}
