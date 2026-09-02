import type { SessionSnapshot } from "@pi-web/protocol";

export interface ActivityItem {
  id: string;
  type: string;
  name: string;
  status: "running" | "done" | "error";
  payload: unknown;
  at: string;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting";

export type SessionControlAction = "abort" | "close" | "resume";

export interface SessionDetailState {
  snapshot: SessionSnapshot | null;
  activities: ActivityItem[];
  liveText: string;
  error: unknown;
  connectionState: ConnectionState;
  replayBusy: boolean;
  controlBusy: SessionControlAction | null;
  firstItemIndex: number;
}

export type SessionDetailAction =
  | { type: "reset" }
  | {
      type: "projection.replaced";
      snapshot: SessionSnapshot;
    }
  | { type: "history.loaded"; snapshot: SessionSnapshot; sessionId: string }
  | {
      type: "projection.event";
      event: import("@pi-web/protocol").RealtimeEvent;
    }
  | {
      type: "session.updated";
      session: import("@pi-web/protocol").SessionRecord;
    }
  | { type: "error.set"; error: unknown }
  | { type: "connection.set"; state: ConnectionState }
  | { type: "replayBusy.set"; busy: boolean }
  | { type: "controlBusy.set"; action: SessionControlAction | null };

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modifiedAt: string;
  mime: string | null;
  preview: "text" | "image" | "audio" | "video" | "pdf" | "none";
}

export interface FileList {
  path: string;
  truncated: boolean;
  entries: FileEntry[];
}

export interface SelectedFile {
  entry: FileEntry;
  content?: string;
}
