import {
  Activity,
  Bot,
  CalendarClock,
  Command,
  LogOut,
  Menu,
  MessageSquarePlus,
  Settings,
  X
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation
} from "./router";
import { useAuth } from "./auth";
import {
  Button,
  ButtonLink,
  ErrorBanner,
  IconButton,
  Loading
} from "./components";
import { CommandPalette } from "./CommandPalette";
import { LoginPage } from "./pages/LoginPage";
import { useUnreadSessions } from "./useUnreadSessions";
import { t, useLanguage } from "./i18n";
import { ui } from "./ui";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage
  }))
);
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

const primaryNavigation = [
  { to: "/", label: "新会话", icon: MessageSquarePlus, end: true },
  { to: "/sessions", label: "会话", icon: Activity },
  { to: "/schedules", label: "调度", icon: CalendarClock },
  { to: "/pi", label: "Pi 管理", icon: Bot }
];

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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/pi" element={<PiManagerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const { logout } = useAuth();
  const location = useLocation();
  const pageRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);
  const workbenchRoute =
    location.pathname === "/" ||
    location.pathname === "/sessions" ||
    /^\/sessions\/[^/]+$/.test(location.pathname);
  const sessionDetailRoute = /^\/sessions\/[^/]+$/.test(location.pathname);
  const unreadSessions = useUnreadSessions();
  useEffect(() => {
    setOpen(false);
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
    if (!open) return;
    function closeNavigation(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeNavigation);
    return () => window.removeEventListener("keydown", closeNavigation);
  }, [open]);
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
    const unreadPrefix =
      unreadSessions.size > 0 ? `(${unreadSessions.size}) ` : "";
    document.title = `${unreadPrefix}${routeTitle(location.pathname)} · Pi Web`;
  }, [location.pathname, unreadSessions]);

  return (
    <div
      className={ui(
        `app-shell${workbenchRoute ? " app-shell-workbench" : ""}${
          sessionDetailRoute ? " app-shell-session-detail" : ""
        }`
      )}
    >
      <aside className={ui(`sidebar ${open ? "sidebar-open" : ""}`)}>
        <div className={ui("sidebar-brand")}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ui("brand-mark command-trigger")}
            aria-label={t("打开命令面板")}
            title={`${t("打开命令面板")} (Ctrl/⌘+K)`}
            onClick={() => setCommandOpen(true)}
          >
            <Command size={21} />
          </Button>
          <div>
            <strong>Pi Web</strong>
            <span>PRIVATE RUNTIME</span>
          </div>
          <button
            className={ui("mobile-close")}
            aria-label={t("关闭导航")}
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav className={ui("nav-list")} aria-label={t("主导航")}>
          {primaryNavigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              {...(end === undefined ? {} : { end })}
              className={({ isActive }) => ui((isActive ? "nav-link active" : "nav-link"))}
              aria-label={t(label)}
              title={t(label)}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className={ui("sidebar-foot")}>
          <div className={ui("runtime-chip")}>
            <span className={ui("pulse-dot")} />
            <div>
              <b>Sessiond</b>
              <small>{t("独立运行中")}</small>
            </div>
          </div>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              ui(isActive ? "nav-link active" : "nav-link")
            }
            aria-label={t("设置")}
            title={t("设置")}
          >
            <Settings size={18} />
            <span>{t("设置")}</span>
          </NavLink>
          <Button className={ui("nav-link logout")} variant="ghost" tooltip={t("退出登录")} aria-label={t("退出登录")} onClick={() => void logout()}>
            <LogOut size={18} />
            <span>{t("退出登录")}</span>
          </Button>
        </div>
      </aside>
      {open && <button className={ui("sidebar-backdrop")} aria-label={t("关闭导航")} onClick={() => setOpen(false)} />}
      <div className={ui("main-column")}>
        <header className={ui("mobile-header")}>
          <IconButton label={t("打开导航")} onClick={() => setOpen(true)}>
            <Menu size={22} />
          </IconButton>
          <span className={ui("mobile-title")}>Pi Web</span>
          <div className={ui("mobile-header-actions")}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ui("mobile-command-trigger")}
              aria-label={t("打开命令面板")}
              title={t("打开命令面板")}
              onClick={() => setCommandOpen(true)}
            >
              <Command size={18} />
            </Button>
            <ButtonLink
              to="/settings"
              variant="ghost"
              size="icon"
              aria-label={t("设置")}
              title={t("设置")}
            >
              <Settings size={19} />
            </ButtonLink>
          </div>
        </header>
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
  if (pathname === "/dashboard") return t("总览");
  if (pathname === "/sessions") return t("会话");
  if (/^\/sessions\/[^/]+$/.test(pathname)) return t("会话");
  if (pathname === "/schedules") return t("调度");
  if (pathname === "/pi") return t("Pi 管理");
  if (pathname === "/settings") return t("设置");
  return "Pi Web";
}
