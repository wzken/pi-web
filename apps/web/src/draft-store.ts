const draftPrefix = "pi-web:draft:";

export function readDraft(scope: string): string {
  if (!scope || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(`${draftPrefix}${scope}`) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(scope: string, value: string): void {
  if (!scope || typeof window === "undefined") return;
  try {
    const key = `${draftPrefix}${scope}`;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Draft persistence is a convenience; input remains usable when storage is blocked.
  }
}

export function clearDraft(scope: string): void {
  writeDraft(scope, "");
}
