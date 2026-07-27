import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import {
  ApiError,
  api,
  isAbortError,
  jsonBody,
  unauthorizedEvent
} from "./api";

interface AuthContextValue {
  authenticated: boolean | null;
  authError: unknown;
  login: (key: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<unknown>(null);

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    setAuthenticated(null);
    setAuthError(null);
    try {
      await api<{ authenticated: true }>(
        "/api/auth/session",
        signal ? { signal } : {}
      );
      setAuthenticated(true);
    } catch (reason) {
      if (isAbortError(reason)) return;
      if (reason instanceof ApiError && reason.status === 401) {
        setAuthenticated(false);
      } else {
        setAuthError(reason);
      }
    }
  }, []);
  const retry = useCallback(async () => {
    await checkSession();
  }, [checkSession]);

  useEffect(() => {
    const unauthenticated = () => {
      setAuthError(null);
      setAuthenticated(false);
    };
    window.addEventListener(unauthorizedEvent, unauthenticated);
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => {
      controller.abort();
      window.removeEventListener(unauthorizedEvent, unauthenticated);
    };
  }, [checkSession]);

  const login = useCallback(async (key: string) => {
    setAuthError(null);
    await api("/api/auth/login", {
      method: "POST",
      ...jsonBody({ key })
    });
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ authenticated, authError, login, logout, retry }),
    [authenticated, authError, login, logout, retry]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
