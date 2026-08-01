import type { SessionRecord } from "@pi-web/protocol";
import { SessionNavigator } from "../../../SessionNavigator";
import { useSessionList } from "../../../useSessionList";

interface SessionRailProps {
  currentId: string;
  cwd: string;
  onClose: () => void;
  onSessionRenamed: (session: SessionRecord) => void;
}

export function SessionRail({
  currentId,
  cwd,
  onClose,
  onSessionRenamed
}: SessionRailProps) {
  const { sessions, setSessions } = useSessionList();

  return (
    <SessionNavigator
      sessions={sessions ?? []}
      currentId={currentId}
      cwd={cwd}
      onClose={onClose}
      onSessionRenamed={(updated) => {
        setSessions((current) =>
          current?.map((session) =>
            session.id === updated.id ? updated : session
          ) ?? null
        );
        onSessionRenamed(updated);
      }}
    />
  );
}
