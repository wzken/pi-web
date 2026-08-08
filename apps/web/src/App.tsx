import { Command } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "./router";
import { useAuth } from "./auth";
import { Button, ErrorBanner, Loading } from "./components";
import { CommandPalette } from "./CommandPalette";
import { LoginPage } from "./pages/LoginPage";
import { useUnreadSessions } from "./useUnreadSessions";
import { t, useLanguage } from "./i18n";
import { ui } from "./ui";
import { WorkspacePageShell } from "./WorkspacePageShell";

const HomePage = lazy(() =>
  import("./pages/HomePage").then((module) => ({ default: module.HomePage }))
);
const PiManagerPage = lazy(() =>
  import("./pages/PiManagerPage").then((module) => ({
    default: module.PiManagerPage
  }))
);
const SchedulesPage = lazy(() =>
  import("./pages/SchedulesPage").then((module) => ({
    default: module.SchedulesPage
  }))
);
const SessionDetailPage = lazy(() =>
  import("./pages/SessionDetailPage").then((module) => ({
    default: module.SessionDetailPage
  }))
);
const SessionsPage = lazy(() =>
  import("./pages/SessionsPage").then((module) => ({
    default: module.SessionsPage
  }))
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage
  }))
);

export function App() {
  useLanguage();
  const { authenticated, authError, retry } = useAuth();
  if (authenticated === null) {
    return (
      <main className={ui("boot-screen")}>
        <div className={ui("brand-mark")}>
          <Command size={25} />
        </div>
        {authError ? (
          <>
            <ErrorBanner error={authError} />
            <Button variant="secondary" onClick={() => void retry()}>
              {t("重新连接")}
            </Button>
          </>
        ) : (
          <Loading label={t("连接 Pi Web")} />
        )}
      </main>
    );
  }
  if (!authenticated) return <LoginPage />;
  return (
    <AppShell>
      <Suspense
        fallback={
          <main className={ui("route-loading")} aria-live="polite">
            <Loading label={t("载入页面")} />
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route
            path="/schedules"
            element={
              <WorkspacePageShell title={t("调度")}>
                <SchedulesPage />
              </WorkspacePageShell>
            }
          />
          <Route
            path="/pi"
            element={
              <WorkspacePageShell title={t("插件")}>
                <PiManagerPage />
              </WorkspacePageShell>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const location = useLocation();
  const pageRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const sessionDetailRoute = /^\/sessions\/[^/]+$/.test(location.pathname);
  const settingsRoute = location.pathname === "/settings";
  const unreadSessions = useUnreadSessions();
  useEffect(() => {
    const changed = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (!changed) return;

    const page = pageRef.current;
    if (!page) return;
    page.scrollTop = 0;
    if (location.pathname === "/") return;

    let stopped = false;
    let observer: MutationObserver | null = null;
    const focusHeading = () => {
      const heading = page.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return true;
    };
    if (!focusHeading()) {
      observer = new MutationObserver(() => {
        if (stopped || !focusHeading()) return;
        observer?.disconnect();
      });
      observer.observe(page, { childList: true, subtree: true });
    }
    const timeout = window.setTimeout(() => observer?.disconnect(), 1500);
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      observer?.disconnect();
    };
  }, [location.pathname]);
  useEffect(() => {
    function openCommandPalette(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", openCommandPalette);
    return () => window.removeEventListener("keydown", openCommandPalette);
  }, []);
  useEffect(() => {
    const openCommandPalette = () => setCommandOpen(true);
    window.addEventListener("pi-web:open-command", openCommandPalette);
    return () =>
      window.removeEventListener("pi-web:open-command", openCommandPalette);
  }, []);
  useEffect(() => {
    const unreadPrefix =
      unreadSessions.size > 0 ? `(${unreadSessions.size}) ` : "";
    document.title = `${unreadPrefix}${routeTitle(location.pathname)} · Pi Web`;
  }, [location.pathname, unreadSessions]);

  return (
    <div
      className={ui(
        `app-shell app-shell-workbench${
          sessionDetailRoute ? " app-shell-session-detail" : ""
        }${settingsRoute ? " app-shell-settings" : ""}`
      )}
    >
      <div className={ui("main-column")}>
        <main ref={pageRef} className={ui("page")}>{children}</main>
      </div>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />
    </div>
  );
}

function routeTitle(pathname: string): string {
  if (pathname === "/") return t("新会话");
  if (pathname === "/sessions") return t("会话");
  if (/^\/sessions\/[^/]+$/.test(pathname)) return t("会话");
  if (pathname === "/schedules") return t("调度");
  if (pathname === "/pi") return t("Pi 管理");
  if (pathname === "/settings") return t("设置");
  return "Pi Web";
}
