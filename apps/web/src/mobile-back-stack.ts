type MobileDismiss = () => void;

const dismissers: Array<{ id: symbol; dismiss: MobileDismiss }> = [];

export function registerMobileDismiss(dismiss: MobileDismiss): () => void {
  const entry = { id: Symbol("mobile-dismiss"), dismiss };
  dismissers.push(entry);
  return () => {
    const index = dismissers.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) dismissers.splice(index, 1);
  };
}

export function dismissTopMobileLayer(): boolean {
  const current = dismissers.at(-1);
  if (!current) return false;
  current.dismiss();
  return true;
}

export function clearMobileDismissersForTests(): void {
  dismissers.length = 0;
}
