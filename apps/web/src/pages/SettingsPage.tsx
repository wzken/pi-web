import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FolderCog,
  KeyRound,
  BellRing,
  Save,
  ShieldAlert,
  Stethoscope,
  Wrench
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { ThinkingLevel } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  ErrorBanner,
  Loading,
  useToast
} from "../components";
import { ThemeSettings } from "../ThemeSettings";
import {
  browserNotificationsAvailable,
  loadNotificationPreferences,
  playCompletionSound,
  requestBrowserNotificationPermission,
  saveNotificationPreferences,
  type NotificationPreferences
} from "../notifications";
import { t } from "../i18n";
import { LanguageSettings } from "../i18n/LanguageSettings";
import { ui } from "../ui";

interface Settings {
  host: string;
  port: number;
  allowedRoots: string[];
  allowAnyDirectory: boolean;
  defaultTimezone: string;
  defaultCronTimeoutSeconds: number;
  minimumCronIntervalMinutes: number;
  modelSchedulePolicy: "allow" | "create_disabled" | "deny";
  piExecutable: string;
  trustedProxy: boolean;
  cookieSecure: "auto" | "always" | "never";
  defaultModel: string | null;
  defaultThinkingLevel: ThinkingLevel | null;
  defaultSystemPrompt: string | null;
  maxScheduledJobs: number;
  maxConcurrentWorkers: number;
  eventBufferSize: number;
}

interface DoctorResult {
  database: boolean;
  socket: string;
  scheduler: boolean;
  activeWorkers: number;
  pi: {
    available: boolean;
    version: string | null;
    rpcStartable: boolean;
    packageCommands: boolean;
    errors: string[];
  };
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roots, setRoots] = useState("");
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(loadNotificationPreferences);
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Settings>("/api/settings", {
        method: "PUT",
        ...jsonBody({
          allowedRoots: roots.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          allowAnyDirectory: settings.allowAnyDirectory,
          defaultTimezone: settings.defaultTimezone,
          defaultCronTimeoutSeconds: settings.defaultCronTimeoutSeconds,
          minimumCronIntervalMinutes: settings.minimumCronIntervalMinutes,
          modelSchedulePolicy: settings.modelSchedulePolicy,
          piExecutable: settings.piExecutable,
          trustedProxy: settings.trustedProxy,
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

  async function runDoctor() {
    if (doctorBusy) return;
    setDoctorBusy(true);
    setDoctor(null);
    setError(null);
    try {
      setDoctor(await api<DoctorResult>("/api/doctor"));
    } catch (reason) {
      setError(reason);
    } finally {
      setDoctorBusy(false);
    }
  }

  async function resetKey() {
    if (!confirm(t("重置访问密钥会立即注销所有浏览器会话。继续吗？"))) return;
    if (resetBusy) return;
    setResetBusy(true);
    try {
      const result = await api<{ key: string }>("/api/auth/reset-key", {
        method: "POST"
      });
      setNewKey(result.key);
    } catch (reason) {
      setError(reason);
    } finally {
      setResetBusy(false);
    }
  }

  async function toggleBrowserNotifications(enabled: boolean) {
    if (enabled) {
      const permission = await requestBrowserNotificationPermission();
      if (permission !== "granted") {
        toast.push(
          permission === "unsupported"
            ? t("当前浏览器不支持系统通知")
            : t("浏览器未授予通知权限"),
          "error"
        );
        return;
      }
    }
    const next = { ...notificationPreferences, browser: enabled };
    setNotificationPreferences(next);
    saveNotificationPreferences(next);
  }

  function toggleCompletionSound(enabled: boolean) {
    const next = { ...notificationPreferences, sound: enabled };
    setNotificationPreferences(next);
    saveNotificationPreferences(next);
    if (enabled) playCompletionSound();
  }

  if (error && !settings) return <ErrorBanner error={error} />;
  if (!settings) return <Loading label={t("读取设置")} />;

  return (
    <>
      <header className={ui("page-header")}>
        <div>
          <p className={ui("eyebrow")}>SETTINGS</p>
          <h1>{t("设置")}</h1>
          <p>{t("限制文件边界、调度策略和 Pi 运行参数。")}</p>
        </div>
        <Button form="settings-form" type="submit" loading={busy} loadingLabel={t("保存中…")}>
          <Save size={16} />
          {t("保存设置")}
        </Button>
      </header>
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <form id="settings-form" className={ui("settings-layout")} onSubmit={save}>
        <section className={ui("settings-main")}>
          <LanguageSettings />

          <ThemeSettings />

          <article className={ui("panel settings-section")}>
            <div className={ui("settings-icon")}><BellRing size={19} /></div>
            <div className={ui("settings-content")}>
              <div className={ui("settings-heading")}>
                <h2>{t("完成提醒")}</h2>
                <p>{t("仅在 Pi Web 位于后台时提醒；内容只显示会话名称。")}</p>
              </div>
              <label className={ui("switch-setting-row")}>
                <span>
                  <strong>{t("浏览器通知")}</strong>
                  <small>
                    {t("会话完成或异常退出时发送系统通知。首次开启会请求浏览器权限。")}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.browser}
                  disabled={!browserNotificationsAvailable()}
                  onChange={(event) =>
                    void toggleBrowserNotifications(event.target.checked)
                  }
                />
              </label>
              <label className={ui("switch-setting-row")}>
                <span>
                  <strong>{t("完成提示音")}</strong>
                  <small>{t("使用浏览器本地生成的短提示音，不加载外部音频。")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPreferences.sound}
                  onChange={(event) =>
                    toggleCompletionSound(event.target.checked)
                  }
                />
              </label>
            </div>
          </article>

          <article className={ui("panel settings-section")}>
            <div className={ui("settings-icon")}><FolderCog size={19} /></div>
            <div className={ui("settings-content")}>
              <div className={ui("settings-heading")}>
                <h2>{t("目录访问")}</h2>
                <p>{t("Pi Web 的目录选择器和文件 API 只能进入这些真实路径。")}</p>
              </div>
              <label className={ui("field")}>
                <span>{t("允许根目录（每行一个）")}</span>
                <textarea className={ui("mono")} rows={5} value={roots} onChange={(event) => setRoots(event.target.value)} />
              </label>
              <label
                className={ui("check-row danger-check")}
                htmlFor="allow-any-directory"
              >
                <input
                  id="allow-any-directory"
                  type="checkbox"
                  checked={settings.allowAnyDirectory}
                  onChange={(event) => setSettings({ ...settings, allowAnyDirectory: event.target.checked })}
                />
                <span>
                  <strong>{t("允许访问任意目录")}</strong>
                  <small>{t("危险：这会关闭 Pi Web 的路径根限制，但不会限制 Pi 自身。")}</small>
                </span>
              </label>
            </div>
          </article>

          <article className={ui("panel settings-section")}>
            <div className={ui("settings-icon")}><Wrench size={19} /></div>
            <div className={ui("settings-content")}>
              <div className={ui("settings-heading")}><h2>{t("Pi 默认值")}</h2><p>{t("新建会话可以覆盖这些值。")}</p></div>
              <div className={ui("field-row")}>
                <label className={ui("field")}>
                  <span>{t("Pi 可执行文件")}</span>
                  <input value={settings.piExecutable} onChange={(event) => setSettings({ ...settings, piExecutable: event.target.value })} />
                </label>
                <label className={ui("field")}>
                  <span>{t("默认模型")}</span>
                  <input
                    value={settings.defaultModel ?? ""}
                    onChange={(event) => setSettings({ ...settings, defaultModel: event.target.value || null })}
                    placeholder="provider/model-id"
                  />
                </label>
              </div>
              <label className={ui("field compact-field")}>
                <span>{t("默认思考级别")}</span>
                <select
                  value={settings.defaultThinkingLevel ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      defaultThinkingLevel: (event.target.value || null) as ThinkingLevel | null
                    })
                  }
                >
                  <option value="">{t("Pi 默认")}</option>
                  {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => <option key={level}>{level}</option>)}
                </select>
              </label>
              <label className={ui("field")}>
                <span>{t("默认附加系统提示词")}</span>
                <textarea
                  rows={7}
                  value={settings.defaultSystemPrompt ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      defaultSystemPrompt: event.target.value || null
                    })
                  }
                  placeholder={t("例如：所有回答使用中文；修改代码后必须运行测试。")}
                />
                <small>
                  {t("新会话启动时通过 Pi 的 --append-system-prompt 注入。它会保留 Pi 自带的编码代理系统提示词；已经运行的会话不会被热修改。")}
                </small>
              </label>
            </div>
          </article>

          <article className={ui("panel settings-section")}>
            <div className={ui("settings-icon")}><ShieldAlert size={19} /></div>
            <div className={ui("settings-content")}>
              <div className={ui("settings-heading")}><h2>{t("Cron 与安全")}</h2><p>{t("模型仍要经过服务端完整校验。")}</p></div>
              <div className={ui("field-row three")}>
                <label className={ui("field")}>
                  <span>{t("默认时区")}</span>
                  <input value={settings.defaultTimezone} onChange={(event) => setSettings({ ...settings, defaultTimezone: event.target.value })} />
                </label>
                <label className={ui("field")}>
                  <span>{t("默认超时（秒）")}</span>
                  <input
                    type="number"
                    min={60}
                    max={86400}
                    value={settings.defaultCronTimeoutSeconds}
                    onChange={(event) => setSettings({ ...settings, defaultCronTimeoutSeconds: Number(event.target.value) })}
                  />
                </label>
                <label className={ui("field")}>
                  <span>{t("最低间隔（分钟）")}</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.minimumCronIntervalMinutes}
                    onChange={(event) => setSettings({ ...settings, minimumCronIntervalMinutes: Number(event.target.value) })}
                  />
                </label>
              </div>
              <div className={ui("field-row")}>
                <label className={ui("field")}>
                  <span>{t("模型创建 Cron 策略")}</span>
                  <select
                    value={settings.modelSchedulePolicy}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        modelSchedulePolicy: event.target.value as Settings["modelSchedulePolicy"]
                      })
                    }
                  >
                    <option value="allow">{t("允许创建并启用")}</option>
                    <option value="create_disabled">{t("仅创建，默认停用")}</option>
                    <option value="deny">{t("拒绝模型调度")}</option>
                  </select>
                </label>
                <label className={ui("field")}>
                  <span>Secure Cookie</span>
                  <select
                    value={settings.cookieSecure}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        cookieSecure: event.target.value as Settings["cookieSecure"]
                      })
                    }
                  >
                    <option value="auto">{t("自动（HTTPS 时启用）")}</option>
                    <option value="always">{t("始终启用")}</option>
                    <option value="never">{t("不启用")}</option>
                  </select>
                </label>
              </div>
            </div>
          </article>
        </section>

        <aside className={ui("settings-aside")}>
          <article className={ui("panel danger-zone")}>
            <KeyRound size={20} />
            <h2>{t("访问密钥")}</h2>
            <p>{t("重置后所有现有浏览器会话会立即失效，新密钥只显示一次。")}</p>
            <Button type="button" variant="danger" loading={resetBusy} loadingLabel={t("重置中…")} onClick={() => void resetKey()}>{t("重置密钥")}</Button>
          </article>
          <article className={ui("panel doctor-card")}>
            <Stethoscope size={20} />
            <h2>{t("系统诊断")}</h2>
            <p>{t("检查数据库、Session Daemon、Scheduler 和 Pi 命令。")}</p>
            <Button type="button" variant="secondary" loading={doctorBusy} loadingLabel={t("诊断中…")} onClick={() => void runDoctor()}>{t("运行 Doctor")}</Button>
            {doctor && (
              <div className={ui("doctor-results")}>
                <DoctorLine ok={doctor.database} label="SQLite" />
                <DoctorLine ok={doctor.scheduler} label="Scheduler" />
                <DoctorLine ok={doctor.pi.available} label={`Pi ${doctor.pi.version ?? ""}`} />
                <DoctorLine ok={doctor.pi.rpcStartable} label={t("Pi RPC 握手")} />
                <DoctorLine ok={doctor.pi.packageCommands} label={t("Package 命令")} />
                <span>{t("{{count}} 个活动 Worker", { count: doctor.activeWorkers })}</span>
              </div>
            )}
          </article>
          <article className={ui("panel doctor-card")}>
            <h2>{t("数据保留")}</h2>
            <p>
              {t("v0.1 不自动删除 Pi 会话文件、调度历史或关联会话。请由服务器管理员按备份策略管理磁盘。")}
            </p>
          </article>
          {location.protocol !== "https:" && (
            <div className={ui("sandbox-warning")}>
              <AlertTriangle size={19} />
              <div>
                <strong>{t("当前连接未加密")}</strong>
                <span>{t("不要通过不可信公网传输访问密钥或控制 Pi。")}</span>
              </div>
            </div>
          )}
          <div className={ui("sandbox-warning")}>
            <AlertTriangle size={19} />
            <div>
              <strong>{t("Pi Web 不提供沙箱")}</strong>
              <span>{t("Pi Worker 拥有运行 Pi Web 的系统用户权限。")}</span>
            </div>
          </div>
        </aside>
      </form>

      {newKey && (
        <div className={ui("dialog-backdrop")}>
          <div className={ui("dialog key-dialog")}>
            <p className={ui("eyebrow")}>SHOWN ONCE</p>
            <h2>{t("保存新的访问密钥")}</h2>
            <p>{t("关闭此窗口后无法再次查看。所有浏览器现已注销。")}</p>
            <code>{newKey}</code>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
                toast.push(t("密钥已复制"));
              }}
            >
              <Clipboard size={16} />{t("复制密钥")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function DoctorLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={ui(ok ? "doctor-ok" : "doctor-fail")}>
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      {label}
    </div>
  );
}
