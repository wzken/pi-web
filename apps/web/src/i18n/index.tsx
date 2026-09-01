import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { enUSMessages } from "./locales/en-US";
import { zhCNMessages } from "./locales/zh-CN";

export type LanguagePreference = "system" | "zh-CN" | "en-US";
export type AppLocale = Exclude<LanguagePreference, "system">;

const languageStorageKey = "pi-web.language";
const defaultLocale: AppLocale = "zh-CN";
let activeLocale: AppLocale = defaultLocale;

interface LanguageContextValue {
  preference: LanguagePreference;
  locale: AppLocale;
  setPreference: (preference: LanguagePreference) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function browserLocale(): AppLocale {
  const languages =
    typeof navigator === "undefined"
      ? []
      : navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];
  if (languages.length === 0) return defaultLocale;
  return languages.some((language) => language.toLowerCase().startsWith("zh"))
    ? "zh-CN"
    : "en-US";
}

function loadPreference(): LanguagePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(languageStorageKey);
  return stored === "zh-CN" || stored === "en-US" || stored === "system"
    ? stored
    : "system";
}

function resolveLocale(preference: LanguagePreference): AppLocale {
  return preference === "system" ? browserLocale() : preference;
}

activeLocale = resolveLocale(loadPreference());

export function LanguageProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>(loadPreference);
  const [systemLocale, setSystemLocale] = useState<AppLocale>(browserLocale);
  const locale = preference === "system" ? systemLocale : preference;
  activeLocale = locale;

  useEffect(() => {
    const update = () => setSystemLocale(browserLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    activeLocale = locale;
    document.documentElement.lang = locale;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    if (description) {
      description.content =
        locale === "zh-CN"
          ? "Pi Coding Agent 的私有远程网页运行时"
          : "Private remote web runtime for Pi Coding Agent";
    }
  }, [locale]);

  const setPreference = useCallback((next: LanguagePreference) => {
    localStorage.setItem(languageStorageKey, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, locale, setPreference }),
    [locale, preference, setPreference]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return value;
}

export function getLocale(): AppLocale {
  return activeLocale;
}

export function t(
  source: string,
  values: Record<string, string | number> = {},
  locale = activeLocale
): string {
  const message =
    (locale === "en-US" ? enUSMessages : zhCNMessages)[source] ?? source;
  return message.replace(/\{\{(\w+)\}\}/g, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function formatRelativeTime(value: string, locale = activeLocale): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "—";
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(elapsed / 60_000);
  if (Math.abs(minutes) < 1) return formatter.format(0, "minute");
  if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

export const languageOptions: ReadonlyArray<{
  value: LanguagePreference;
  label: string;
}> = [
  { value: "system", label: "跟随系统" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "英语" }
];
