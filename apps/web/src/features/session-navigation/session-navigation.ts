import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { SessionRecord } from "@pi-web/protocol";

const sidebarSectionStoragePrefix = "pi-web:sidebar-section:";

export interface SidebarDirectory {
  path: string;
  alias: string | null;
  favorite: boolean;
  lastUsedAt: string;
}

export interface SidebarProject {
  cwd: string;
  name: string;
  sessionCount: number;
  updatedAt: string;
  sessions: SessionRecord[];
}

export function buildSidebarProjects(
  sessions: SessionRecord[],
  directories: SidebarDirectory[],
  currentCwd?: string
): SidebarProject[] {
  const projects = new Map<string, SidebarProject>();
  for (const directory of directories.filter((item) => item.favorite)) {
    const key = workspaceKey(directory.path);
    projects.set(key, {
      cwd: directory.path,
      name: directory.alias?.trim() || projectName(directory.path),
      sessionCount: 0,
      updatedAt: directory.lastUsedAt,
      sessions: []
    });
  }
  for (const session of sessions) {
    const key = workspaceKey(session.cwd);
    const project = projects.get(key);
    if (!project) continue;
    project.sessions.push(session);
    project.sessionCount += 1;
    if (session.updatedAt > project.updatedAt) project.updatedAt = session.updatedAt;
  }
  return [...projects.values()].sort((left, right) => {
    const leftCurrent = currentCwd
      ? sameWorkspace(left.cwd, currentCwd)
      : false;
    const rightCurrent = currentCwd
      ? sameWorkspace(right.cwd, currentCwd)
      : false;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function buildStandaloneSessions(
  sessions: SessionRecord[],
  projects: SidebarProject[]
): SessionRecord[] {
  const projectKeys = new Set(projects.map((project) => workspaceKey(project.cwd)));
  return sessions.filter((session) => !projectKeys.has(workspaceKey(session.cwd)));
}

export function compareSidebarSessions(
  left: SessionRecord,
  right: SessionRecord
): number {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) {
    return left.pinned ? -1 : 1;
  }
  if (left.pinned && right.pinned) {
    const pinnedOrder = (right.pinnedAt ?? right.updatedAt).localeCompare(
      left.pinnedAt ?? left.updatedAt
    );
    if (pinnedOrder !== 0) return pinnedOrder;
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function useSidebarSectionCollapsed(
  section: "projects" | "chats"
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const storageKey = `${sidebarSectionStoragePrefix}${section}`;
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(collapsed));
    } catch {
      // Sidebar sections still work when browser storage is unavailable.
    }
  }, [collapsed, storageKey]);
  return [collapsed, setCollapsed];
}

export function workspaceKey(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized)
    ? normalized.toLocaleLowerCase()
    : normalized;
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

export function sameWorkspace(left: string, right: string): boolean {
  return workspaceKey(left) === workspaceKey(right);
}
