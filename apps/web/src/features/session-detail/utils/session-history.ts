interface HistoryResponseIdentity {
  requestedSessionId: string;
  activeSessionId: string;
  responseSessionId: string;
  requestedGeneration: number;
  currentGeneration: number;
  aborted: boolean;
}

export function shouldApplyHistoryResponse({
  requestedSessionId,
  activeSessionId,
  responseSessionId,
  requestedGeneration,
  currentGeneration,
  aborted
}: HistoryResponseIdentity): boolean {
  return (
    !aborted &&
    requestedSessionId === activeSessionId &&
    responseSessionId === requestedSessionId &&
    requestedGeneration === currentGeneration
  );
}
