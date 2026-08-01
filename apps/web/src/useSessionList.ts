import type { SessionRecord } from "@pi-web/protocol";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import { api, isAbortError } from "./api";
import { isCacheFresh } from "./cache-policy";

export const sessionListTtlMs = 30_000;

interface SessionListState {
  sessions: SessionRecord[] | null;
  setSessions: Dispatch<SetStateAction<SessionRecord[] | null>>;
  error: unknown;
  refresh: (force?: boolean) => Promise<boolean>;
}

export function useSessionList(): SessionListState {
  const [sessions, setSessionState] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadedAt = useRef<number | null>(null);
  const requestGeneration = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (
      !force &&
      isCacheFresh(loadedAt.current, Date.now(), sessionListTtlMs)
    ) {
      return false;
    }
    const generation = ++requestGeneration.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const next = await api<SessionRecord[]>("/api/sessions", {
        signal: controller.signal
      });
      if (
        controller.signal.aborted ||
        requestGeneration.current !== generation
      ) {
        return false;
      }
      loadedAt.current = Date.now();
      setSessionState(next);
      setError(null);
      return true;
    } catch (reason) {
      if (
        !isAbortError(reason) &&
        requestGeneration.current === generation
      ) {
        setError(reason);
      }
      return false;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  const setSessions = useCallback<
    Dispatch<SetStateAction<SessionRecord[] | null>>
  >((update) => {
    invalidateSessionListRequest(
      requestGeneration,
      controllerRef
    );
    setError(null);
    setSessionState(update);
  }, []);

  useEffect(() => {
    void refresh(true);
    const revalidate = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const handleOnline = () => {
      void refresh(true);
    };
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, sessionListTtlMs);
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      requestGeneration.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [refresh]);

  return { sessions, setSessions, error, refresh };
}

export function invalidateSessionListRequest(
  generation: { current: number },
  controller: { current: AbortController | null }
): void {
  generation.current += 1;
  controller.current?.abort();
  controller.current = null;
}
