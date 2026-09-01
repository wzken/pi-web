import { AlertTriangle, ArrowRight, Command, KeyRound, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Button } from "../components";
import { t } from "../i18n";
import { localizedErrorMessage } from "../api";
import { ui } from "../ui";

export function LoginPage() {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !key) return;
    setBusy(true);
    setError(null);
    try {
      await login(key);
    } catch (reason) {
      setError(
        reason instanceof Error ? localizedErrorMessage(reason) : t("登录失败")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={ui("login-page")}>
      <section className={ui("login-intro")}>
        <div className={ui("login-logo")}>
          <Command size={28} />
          <span>PI WEB</span>
        </div>
        <div className={ui("login-copy")}>
          <p className={ui("eyebrow")}>YOUR AGENT. ALWAYS ON.</p>
          <h1>{t("让 Pi 留在工作现场。")}</h1>
          <p>
            {t("从电脑、手机或平板接管长期运行的 Coding Agent。浏览器关闭，任务仍然继续。")}
          </p>
        </div>
        <div className={ui("login-runtime")}>
          <span className={ui("pulse-dot")} />
          <div>
            <strong>{t("本机运行时已就绪")}</strong>
            <small>{t("单用户 · 私有部署 · 持久会话")}</small>
          </div>
        </div>
      </section>
      <section className={ui("login-panel")}>
        <form className={ui("login-card")} onSubmit={submit}>
          <div className={ui("login-card-icon")}>
            <LockKeyhole size={24} />
          </div>
          <p className={ui("eyebrow")}>SECURE ACCESS</p>
          <h2>{t("进入你的 Pi Web")}</h2>
          <p className={ui("muted")}>
            {t("输入首次安装时显示的访问密钥。密钥不会保存在浏览器本地存储中。")}
          </p>
          {location.protocol !== "https:" && (
            <div className={ui("inline-error")}>
              <AlertTriangle size={16} />
              {t("当前连接未加密。不要通过不可信公网传输访问密钥或控制 Pi。")}
            </div>
          )}
          <label className={ui("field")}>
            <span>{t("访问密钥")}</span>
            <div className={ui("input-with-icon")}>
              <KeyRound size={17} />
              <input
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t("粘贴访问密钥")}
                autoFocus
              />
            </div>
          </label>
          {error && (
            <div className={ui("inline-error")}>
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          <Button type="submit" disabled={!key} loading={busy} loadingLabel={t("正在验证…")} className={ui("login-submit")}>
            {t("安全登录")}
            <ArrowRight size={17} />
          </Button>
          <p className={ui("login-help")}>
            {t("密钥遗失？在服务器运行 {{command}}。", {
              command: "pi-web reset-key"
            })}
          </p>
        </form>
      </section>
    </main>
  );
}
