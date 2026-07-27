import type { SessionRecord } from "@pi-web/protocol";
import { useEffect, useState } from "react";
import { api } from "../../../api";
import { SessionNavigator } from "../../../SessionNavigator";
import { FileBrowser } from "./FileBrowser";

interface SessionRailProps {
  currentId: string;
  cwd: string;
  onSessionRenamed: (session: SessionRecord) => void;
}

export function SessionRail({
  currentId,
  cwd,
  onSessionRenamed
}: SessionRailProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    api<SessionRecord[]>("/api/sessions", { signal: controller.signal })
      .then(setSessions)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <SessionNavigator
      sessions={sessions}
      currentId={currentId}
      cwd={cwd}
      onSessionRenamed={(updated) => {
        setSessions((current) =>
          current.map((session) =>
            session.id === updated.id ? updated : session
          )
        );
        onSessionRenamed(updated);
      }}
      explorer={
        <FileBrowser
          key={`rail-files:${currentId}`}
          sessionId={currentId}
          cwd={cwd}
          onClose={() => undefined}
          compact
        />
      }
    />
  );
}
