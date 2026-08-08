import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clipboard,
  FolderCog,
  KeyRound,
  Save,
  Settings2,
  ShieldCheck,
  Stethoscope,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ThinkingLevel } from "@pi-web/protocol";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  Dialog,
  ErrorBanner,
  IconButton,
  Loading,
  Switch,
  useToast
} from "../components";
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
import { useNavigate } from "../router";
import { ui } from "../ui";
import styles from "./SettingsPage.module.css";

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

const settingsLinks = [
  { href: "#task-defaults", label: "常规", icon: Settings2 },
  { href: "#preferences", label: "通知与语言", icon: BellRing },
  { href: "#security", label: "安全与系统", icon: ShieldCheck }
] as const;

export function SettingsPage() {
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [roots, setRoots] = useState("");
  const [doctor, setDoctor] = useState<DoctorResult | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("task-defaults");
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(loadNotificationPreferences);
  const toast = useToast();
  const settingsReady = settings !== null;

  useEffect(() => {
    if (!settingsReady) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-settings-close]")
        ?.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        navigate("/");
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"
        ) ?? []
      ).filter((control) => control.offsetParent !== null);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [navigate, settingsReady]);

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
    <div className={styles.page}>
      <section
        ref={dialogRef}
        className={styles.settingsShell}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <nav className={styles.settingsNav} aria-label={t("设置")}>
          <div className={styles.settingsNavHeader}>
            <strong>{t("设置")}</strong>
            <IconButton
              data-settings-close
              label={t("关闭设置")}
              size="sm"
              onClick={() => navigate("/")}
            >
              <X size={17} />
            </IconButton>
          </div>
          <span className={styles.navLabel}>PI WEB</span>
          {settingsLinks.map(({ href, label, icon: Icon }) => {
            const sectionId = href.slice(1);
            const active = activeSection === sectionId;
            return (
              <a
                key={href}
                className={active ? styles.navActive : undefined}
                href={href}
                aria-current={active ? "location" : undefined}
                onClick={() => setActiveSection(sectionId)}
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

          <form id="settings-form" className={styles.settingsContent} onSubmit={save}>
          <section
            id="task-defaults"
            className={styles.settingsCard}
            aria-labelledby="task-defaults-title"
          >
            <div className={styles.sectionHeading}>
              <span className={styles.sectionIcon} aria-hidden="true">
                <Settings2 size={20} />
              </span>
              <div>
                <h2 id="task-defaults-title">{t("任务默认值")}</h2>
                <p>{t("新建会话可以覆盖这些值。")}</p>
              </div>
            </div>

            <div className={styles.formGroup}>
              <div className={styles.groupHeading}>
                <Wrench size={18} aria-hidden="true" />
                <div>
                  <h3>{t("模型与行为")}</h3>
                  <p>{t("为每个新任务提供一致的模型、思考和指令默认值。")}</p>
                </div>
              </div>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span>{t("默认模型")}</span>
                  <input
                    value={settings.defaultModel ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        defaultModel: event.target.value || null
                      })
                    }
                    placeholder="provider/model-id"
                  />
                </label>
                <label className={styles.field}>
                  <span>{t("默认思考级别")}</span>
                  <select
                    value={settings.defaultThinkingLevel ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        defaultThinkingLevel: (event.target.value ||
                          null) as ThinkingLevel | null
                      })
                    }
                  >
                    <option value="">{t("Pi 默认")}</option>
                    {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
                      (level) => (
                        <option key={level}>{level}</option>
                      )
                    )}
                  </select>
                </label>
              </div>
              <label className={styles.field}>
                <span>{t("默认附加系统提示词")}</span>
                <textarea
                  rows={5}
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
                  {t(
                    "新会话启动时通过 Pi 的 --append-system-prompt 注入。它会保留 Pi 自带的编码代理系统提示词；已经运行的会话不会被热修改。"
                  )}
                </small>
              </label>
            </div>

            <div className={styles.formGroup}>
              <div className={styles.groupHeading}>
                <FolderCog size={18} aria-hidden="true" />
                <div>
                  <h3>{t("工作区与运行环境")}</h3>
                  <p>{t("约束任务可访问的位置，并指定 Pi 的默认运行方式。")}</p>
                </div>
              </div>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span>{t("Pi 可执行文件")}</span>
                  <input
                    value={settings.piExecutable}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        piExecutable: event.target.value
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>{t("默认时区")}</span>
                  <input
                    value={settings.defaultTimezone}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        defaultTimezone: event.target.value
                      })
                    }
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>{t("允许根目录（每行一个）")}</span>
                <textarea
                  className={styles.mono}
                  rows={4}
                  value={roots}
                  onChange={(event) => setRoots(event.target.value)}
                />
                <small>
                  {t("Pi Web 的目录选择器和文件 API 只能进入这些真实路径。")}
                </small>
              </label>
              <ToggleRow
                label={t("允许访问任意目录")}
                description={t(
                  "危险：这会关闭 Pi Web 的路径根限制，但不会限制 Pi 自身。"
                )}
                checked={settings.allowAnyDirectory}
                danger
                onChange={(checked) =>
                  setSettings({ ...settings, allowAnyDirectory: checked })
                }
              />
            </div>
          </section>

          <section
            id="preferences"
            className={styles.settingsCard}
            aria-labelledby="preferences-title"
          >
            <div className={styles.sectionHeading}>
              <span className={styles.sectionIcon} aria-hidden="true">
                <BellRing size={20} />
              </span>
              <div>
                <h2 id="preferences-title">{t("偏好设置")}</h2>
                <p>{t("仅影响当前浏览器中的语言和完成提醒。")}</p>
              </div>
            </div>

            <div className={styles.embeddedLanguage}>
              <LanguageSettings />
            </div>

            <div className={styles.toggleList}>
              <ToggleRow
                label={t("浏览器通知")}
                description={t(
                  "任务结束或会话异常退出时发送系统通知。首次开启会请求浏览器权限。"
                )}
                checked={notificationPreferences.browser}
                disabled={!browserNotificationsAvailable()}
                onChange={(checked) => void toggleBrowserNotifications(checked)}
              />
              <ToggleRow
                label={t("完成提示音")}
                description={t(
                  "使用浏览器本地生成的短提示音，不加载外部音频。"
                )}
                checked={notificationPreferences.sound}
                onChange={toggleCompletionSound}
              />
            </div>
          </section>

          <section
            id="security"
            className={ui(styles.settingsCard, styles.secondaryCard)}
            aria-labelledby="security-title"
          >
            <div className={styles.sectionHeading}>
              <span className={styles.sectionIcon} aria-hidden="true">
                <ShieldCheck size={20} />
              </span>
              <div>
                <h2 id="security-title">{t("安全与诊断")}</h2>
                <p>{t("不常用的调度、安全与系统维护选项。")}</p>
              </div>
            </div>

            <details className={styles.advancedDisclosure}>
              <summary>
                <span>
                  <strong>{t("Cron 与安全")}</strong>
                  <small>{t("模型仍要经过服务端完整校验。")}</small>
                </span>
              </summary>
              <div className={styles.advancedContent}>
                <div className={styles.fieldGridThree}>
                  <label className={styles.field}>
                    <span>{t("默认超时（秒）")}</span>
                    <input
                      type="number"
                      min={60}
                      max={86400}
                      value={settings.defaultCronTimeoutSeconds}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          defaultCronTimeoutSeconds: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>{t("最低间隔（分钟）")}</span>
                    <input
                      type="number"
                      min={1}
                      value={settings.minimumCronIntervalMinutes}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          minimumCronIntervalMinutes: Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Secure Cookie</span>
                    <select
                      value={settings.cookieSecure}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          cookieSecure: event.target
                            .value as Settings["cookieSecure"]
                        })
                      }
                    >
                      <option value="auto">{t("自动（HTTPS 时启用）")}</option>
                      <option value="always">{t("始终启用")}</option>
                      <option value="never">{t("不启用")}</option>
                    </select>
                  </label>
                </div>
                <label className={styles.field}>
                  <span>{t("模型创建 Cron 策略")}</span>
                  <select
                    value={settings.modelSchedulePolicy}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        modelSchedulePolicy: event.target
                          .value as Settings["modelSchedulePolicy"]
                      })
                    }
                  >
                    <option value="allow">{t("允许创建并启用")}</option>
                    <option value="create_disabled">
                      {t("仅创建，默认停用")}
                    </option>
                    <option value="deny">{t("拒绝模型调度")}</option>
                  </select>
                </label>
              </div>
            </details>

            <div className={styles.maintenanceGrid}>
              <article className={styles.maintenanceCard}>
                <KeyRound size={20} aria-hidden="true" />
                <h3>{t("访问密钥")}</h3>
                <p>
                  {t(
                    "重置后所有现有浏览器会话会立即失效，新密钥只显示一次。"
                  )}
                </p>
                <Button
                  type="button"
                  variant="danger"
                  loading={resetBusy}
                  loadingLabel={t("重置中…")}
                  onClick={() => void resetKey()}
                >
                  {t("重置密钥")}
                </Button>
              </article>

              <article className={styles.maintenanceCard}>
                <Stethoscope size={20} aria-hidden="true" />
                <h3>{t("系统诊断")}</h3>
                <p>{t("检查数据库、Session Daemon、Scheduler 和 Pi 命令。")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  loading={doctorBusy}
                  loadingLabel={t("诊断中…")}
                  onClick={() => void runDoctor()}
                >
                  {t("运行 Doctor")}
                </Button>
                {doctor && (
                  <div className={styles.doctorResults} aria-live="polite">
                    <DoctorLine ok={doctor.database} label="SQLite" />
                    <DoctorLine ok={doctor.scheduler} label="Scheduler" />
                    <DoctorLine
                      ok={doctor.pi.available}
                      label={`Pi ${doctor.pi.version ?? ""}`}
                    />
                    <DoctorLine
                      ok={doctor.pi.rpcStartable}
                      label={t("Pi RPC 握手")}
                    />
                    <DoctorLine
                      ok={doctor.pi.packageCommands}
                      label={t("Package 命令")}
                    />
                    <span>
                      {t("{{count}} 个活动 Worker", {
                        count: doctor.activeWorkers
                      })}
                    </span>
                  </div>
                )}
              </article>
            </div>

            <div className={styles.systemNotes}>
              <div>
                <strong>{t("数据保留")}</strong>
                <span>
                  {t(
                    "v0.1 不自动删除 Pi 会话文件、调度历史或关联会话。请由服务器管理员按备份策略管理磁盘。"
                  )}
                </span>
              </div>
              {location.protocol !== "https:" && (
                <div className={styles.warningNote}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>
                    <strong>{t("当前连接未加密")}</strong>
                    {t("不要通过不可信公网传输访问密钥或控制 Pi。")}
                  </span>
                </div>
              )}
              <div className={styles.warningNote}>
                <AlertTriangle size={18} aria-hidden="true" />
                <span>
                  <strong>{t("Pi Web 不提供沙箱")}</strong>
                  {t("Pi Worker 拥有运行 Pi Web 的系统用户权限。")}
                </span>
              </div>
            </div>
          </section>
          </form>
        </div>
      </section>

      {newKey && (
        <Dialog
          open
          labelledBy="new-key-title"
          onClose={() => setNewKey(null)}
          className={ui("key-dialog")}
          maxWidth={480}
        >
          <p className={ui("eyebrow")}>SHOWN ONCE</p>
          <h2 id="new-key-title">{t("保存新的访问密钥")}</h2>
          <p>{t("关闭此窗口后无法再次查看。所有浏览器现已注销。")}</p>
          <code>{newKey}</code>
          <div className={styles.dialogActions}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setNewKey(null)}
            >
              {t("关闭")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
                toast.push(t("密钥已复制"));
              }}
            >
              <Clipboard size={16} />
              {t("复制密钥")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  danger = false,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  danger?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={ui(styles.toggleRow, danger && styles.dangerToggle)}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch
        className={styles.rowSwitch}
        label={label}
        checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function DoctorLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={ok ? styles.doctorOk : styles.doctorFail}>
      {ok ? (
        <CheckCircle2 size={15} aria-hidden="true" />
      ) : (
        <AlertTriangle size={15} aria-hidden="true" />
      )}
      {label}
    </div>
  );
}
