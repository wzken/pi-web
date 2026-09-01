import { Command } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "./router";
import { useAuth } from "./auth";
import { Button, ErrorBanner, Loading } from "./components";
import { CommandPalette } from "./CommandPalette";
import { LoginPage } from "./pages/LoginPage";
import { NotificationProvider } from "./notification-context";
import { useNotifications } from "./notification-context";
import { t, useLanguage } from "./i18n";
import { startSystemColorSchemeSync } from "./system-color-scheme";
import { ui } from "./ui";
import { WorkspacePageShell } from "./WorkspacePageShell";
import { useKeyboardInset } from "./mobile-viewport";
import { ThemeProvider } from "./theme";

const HomePage = lazy(() =>
  import("./pages/HomePage").then((module) => ({ default: module.HomePage }))
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage").then((module) => ({
    default: module.NotificationsPage
  }))
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
  useKeyboardInset();
  const { authenticated, authError, retry } = useAuth();
  if (authenticated === null) {
    return (
      <SystemAppearance>
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
      </SystemAppearance>
    );
  }
  if (!authenticated) {
    return (
      <SystemAppearance>
        <LoginPage />
      </SystemAppearance>
    );
  }
  return (
    <ThemeProvider>
      <NotificationProvider>
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
          <Route
            path="/sessions"
            element={
              <WorkspacePageShell title={t("会话")}>
                <SessionsPage />
              </WorkspacePageShell>
            }
          />
          <Route
            path="/notifications"
            element={
              <WorkspacePageShell title={t("通知中心")}>
                <NotificationsPage />
              </WorkspacePageShell>
            }
          />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route
            path="/schedules"
            element={
              <WorkspacePageShell title={t("调度")}>
                <SchedulesPage />
              </WorkspacePageShell>
            }
          />
          <Route path="/pi" element={<PiManagerRoute />} />
          <Route
            path="/settings"
            element={
              <WorkspacePageShell title={t("设置")}>
                <SettingsPage />
              </WorkspacePageShell>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </AppShell>
      </NotificationProvider>
    </ThemeProvider>
  );
}

function SystemAppearance({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const safeMode =
      new URLSearchParams(window.location.search).get("safe-theme") === "1";
    return startSystemColorSchemeSync(
      document.documentElement,
      window.matchMedia("(prefers-color-scheme: dark)"),
      safeMode ? "light" : undefined
    );
  }, []);
  return children;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const location = useLocation();
  const pageRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const sessionDetailRoute = /^\/sessions\/[^/]+$/.test(location.pathname);
  const workspacePageRoute = location.pathname !== "/" && !sessionDetailRoute;
  const settingsRoute = location.pathname === "/settings";
  const { unreadCount } = useNotifications();
  useEffect(() => {
    const changed = previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (!changed) return;

    const page = pageRef.current;
    if (!page) return;
    page.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0 });
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
    const unreadPrefix = unreadCount > 0 ? `(${unreadCount}) ` : "";
    document.title = `${unreadPrefix}${routeTitle(location.pathname)} · Pi Web`;
  }, [location.pathname, location.search, unreadCount]);

  return (
    <div
      className={ui(
        `app-shell app-shell-workbench app-redesign${
          sessionDetailRoute ? " app-shell-session-detail" : ""
        }${workspacePageRoute ? " app-shell-workspace-page" : ""}${
          settingsRoute ? " app-shell-settings" : ""
        }`
      )}
    >
      <a className={ui("skip-link")} href="#main-content">
        {t("跳到主要内容")}
      </a>
      <div className={ui("main-column")}>
        <main id="main-content" ref={pageRef} className={ui("page")}>
          {children}
        </main>
      </div>
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
      />
    </div>
  );
}

function PiManagerRoute() {
  return (
    <WorkspacePageShell title={t("Pi 管理")}>
      <PiManagerPage />
    </WorkspacePageShell>
  );
}

function routeTitle(pathname: string): string {
  if (pathname === "/") return t("新会话");
  if (pathname === "/sessions") return t("会话");
  if (pathname === "/notifications") return t("通知中心");
  if (/^\/sessions\/[^/]+$/.test(pathname)) return t("会话");
  if (pathname === "/schedules") return t("调度");
  if (pathname === "/pi") return t("Pi 管理");
  if (pathname === "/settings") return t("设置");
  return "Pi Web";
}
