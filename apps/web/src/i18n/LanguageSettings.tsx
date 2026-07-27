import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  languageOptions,
  useLanguage,
  type LanguagePreference
} from "./index";
import { ui } from "../ui";

export function LanguageSettings() {
  const { preference, setPreference } = useLanguage();
  const { t } = useTranslation();

  return (
    <article className={ui("panel settings-section")}>
      <div className={ui("settings-icon")}>
        <Languages size={19} />
      </div>
      <div className={ui("settings-content")}>
        <div className={ui("settings-heading")}>
          <h2>{t("界面语言")}</h2>
          <p>{t("语言只保存在当前浏览器，可跟随操作系统设置。")}</p>
        </div>
        <label className={ui("field compact-field")}>
          <span>{t("语言")}</span>
          <select
            value={preference}
            onChange={(event) =>
              setPreference(event.target.value as LanguagePreference)
            }
          >
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
