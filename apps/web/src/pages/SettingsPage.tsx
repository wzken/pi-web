import { BellRing, Palette, Save, Settings2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PiWebSettings as Settings } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  ErrorBanner,
  Loading,
  useToast
} from "../components";
import { t } from "../i18n";
import { ThemeSettings } from "../ThemeSettings";
import { ui } from "../ui";
import styles from "./SettingsPage.module.css";
import { TaskDefaultsSection } from "../features/settings/TaskDefaultsSection";
import { PreferencesSection } from "../features/settings/PreferencesSection";
import { SecuritySection } from "../features/settings/SecuritySection";

const settingsLinks = [
  { href: "#appearance", label: "外观", icon: Palette },
  { href: "#task-defaults", label: "常规", icon: Settings2 },
  { href: "#preferences", label: "通知与语言", icon: BellRing },
  { href: "#security", label: "安全与系统", icon: ShieldCheck }
] as const;

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roots, setRoots] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [activeSection, setActiveSection] = useState(() =>
    settingsLinks.some(({ href }) => href === window.location.hash)
      ? window.location.hash.slice(1)
      : "appearance"
  );
  const settingsContentRef = useRef<HTMLFormElement>(null);
  const toast = useToast();

  useEffect(() => {
    const controller = new AbortController();
    api<Settings>("/api/settings", { signal: controller.signal })
      .then((value) => {
        setSettings(value);
        setRoots(value.allowedRoots.join("\n"));
      })
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const updateSectionFromHash = () => {
      const next = window.location.hash.slice(1);
      if (settingsLinks.some(({ href }) => href === `#${next}`)) {
        setActiveSection(next);
        const section = document.getElementById(next);
        const content = settingsContentRef.current;
        if (section && content) {
          window.requestAnimationFrame(() =>
            content.scrollTo({
              top: section.offsetTop,
              behavior: "auto"
            })
          );
        }
      }
    };
    updateSectionFromHash();
    window.addEventListener("hashchange", updateSectionFromHash);
    return () => window.removeEventListener("hashchange", updateSectionFromHash);
  }, []);

  useEffect(() => {
    const content = settingsContentRef.current;
    if (!content) return;
    const outer = content.closest<HTMLElement>(".workspace-page-content");
    let frame = 0;
    const updateActiveSection = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const scrollRoot =
          content.scrollHeight > content.clientHeight + 1 ? content : outer ?? content;
        const rootTop = scrollRoot.getBoundingClientRect().top;
        const sections = settingsLinks
          .map(({ href }) => document.getElementById(href.slice(1)))
          .filter((section): section is HTMLElement => section !== null);
        const next = sections.reduce((active, section) => {
          return section.getBoundingClientRect().top - rootTop <= 40
            ? section
            : active;
        }, sections[0]);
        if (next?.id) setActiveSection(next.id);
      });
    };
    const resizeObserver = new ResizeObserver(updateActiveSection);
    resizeObserver.observe(content);
    updateActiveSection();
    content.addEventListener("scroll", updateActiveSection, { passive: true });
    outer?.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      content.removeEventListener("scroll", updateActiveSection);
      outer?.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [settings]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Settings>("/api/settings", {
        method: "PUT",
        ...jsonBody({
          allowedRoots: roots
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          allowAnyDirectory: settings.allowAnyDirectory,
          defaultTimezone: settings.defaultTimezone,
          defaultCronTimeoutSeconds: settings.defaultCronTimeoutSeconds,
          minimumCronIntervalMinutes: settings.minimumCronIntervalMinutes,
          modelSchedulePolicy: settings.modelSchedulePolicy,
          piExecutable: settings.piExecutable,
          cookieSecure: settings.cookieSecure,
          defaultModel: settings.defaultModel,
          defaultThinkingLevel: settings.defaultThinkingLevel,
          defaultSystemPrompt: settings.defaultSystemPrompt
        })
      });
      setSettings(updated);
      toast.push(t("设置已保存"));
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <ErrorBanner error={error} />;
  if (!settings) return <Loading label={t("读取设置")} />;

  return (
    <div className={ui(styles.page, "settings-redesign-page")}>
      <section
        className={styles.settingsShell}
        aria-labelledby="settings-title"
      >
        <nav className={styles.settingsNav} aria-label={t("设置")}>
          <div className={styles.settingsNavHeader}>
            <strong>PI WEB</strong>
            <span>{t("设置")}</span>
          </div>
          <span className={styles.navLabel}>{t("设置分类")}</span>
          {settingsLinks.map(({ href, label, icon: Icon }) => {
            const sectionId = href.slice(1);
            const active = activeSection === sectionId;
            return (
              <a
                key={href}
                className={active ? styles.navActive : undefined}
                href={href}
                aria-current={active ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveSection(sectionId);
                  window.history.replaceState(null, "", href);
                  const section = document.getElementById(sectionId);
                  const content = settingsContentRef.current;
                  if (section && content) {
                    content.scrollTo({
                      top: section.offsetTop,
                      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "auto"
                        : "smooth"
                    });
                  }
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {t(label)}
              </a>
            );
          })}
        </nav>

        <div className={styles.settingsMain}>
          <header className={styles.pageHeader}>
            <div>
              <h1 id="settings-title">{t("设置")}</h1>
              <p>{t("限制文件边界、调度策略和 Pi 运行参数。")}</p>
            </div>
            <Button
              form="settings-form"
              type="submit"
              loading={busy}
              loadingLabel={t("保存中…")}
            >
              <Save size={17} />
              {t("保存设置")}
            </Button>
          </header>

          {error !== null && (
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          )}

          <form
            ref={settingsContentRef}
            id="settings-form"
            className={styles.settingsContent}
            onSubmit={save}
          >
          <ThemeSettings />

          <TaskDefaultsSection
            settings={settings}
            roots={roots}
            onChange={setSettings}
            onRootsChange={setRoots}
            onError={setError}
          />

          <PreferencesSection />

          <SecuritySection settings={settings} onChange={setSettings} />
          </form>
        </div>
      </section>

    </div>
  );
}
