import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  KeyRound,
  ShieldCheck,
  Stethoscope,
  Wifi
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PiWebSettings,
  RemoteAccessInfo,
  SessiondDoctorResult
} from "@pi-web/protocol";
import { api, isAbortError } from "../../api";
import { Button, Dialog, ErrorBanner, Loading, useToast } from "../../components";
import { t } from "../../i18n";
import { ui } from "../../ui";
import styles from "../../pages/SettingsPage.module.css";

export function SecuritySection({
  settings,
  onChange
}: {
  settings: PiWebSettings;
  onChange: (settings: PiWebSettings) => void;
}) {
  const [doctor, setDoctor] = useState<SessiondDoctorResult | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [remoteAccess, setRemoteAccess] = useState<RemoteAccessInfo | null>(null);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(true);
  const toast = useToast();

  useEffect(() => {
    const controller = new AbortController();
    void api<RemoteAccessInfo>("/api/remote-access", { signal: controller.signal })
      .then(setRemoteAccess)
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason);
      })
      .finally(() => setRemoteAccessBusy(false));
    return () => controller.abort();
  }, []);

  async function runDoctor() {
    if (doctorBusy) return;
    setDoctorBusy(true);
    setDoctor(null);
    setError(null);
    try {
      setDoctor(await api<SessiondDoctorResult>("/api/doctor"));
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

  return (
    <>
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

            {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

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
                        onChange({
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
                        onChange({
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
                        onChange({
                          ...settings,
                          cookieSecure: event.target
                            .value as PiWebSettings["cookieSecure"]
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
                      onChange({
                        ...settings,
                        modelSchedulePolicy: event.target
                          .value as PiWebSettings["modelSchedulePolicy"]
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
              <article className={ui(styles.maintenanceCard, styles.remoteAccessCard)}>
                <Wifi size={20} aria-hidden="true" />
                <h3>{t("远程入口")}</h3>
                <p>
                  {t(
                    "扫描二维码在手机打开首选地址。Pi Web 不会自动修改 Tailscale 或网络配置。"
                  )}
                </p>
                {remoteAccessBusy ? (
                  <Loading label={t("检测远程入口")} />
                ) : remoteAccess ? (
                  <div className={styles.remoteAccessContent}>
                    <img
                      src={remoteAccess.qrDataUrl}
                      alt={t("首选远程地址二维码")}
                      width={160}
                      height={160}
                      loading="lazy"
                      decoding="async"
                    />
                    <div className={styles.remoteAddressList}>
                      <div className={styles.preferredAddress}>
                        <span>{t("首选地址")}</span>
                        <code>{remoteAccess.preferredUrl}</code>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              remoteAccess.preferredUrl
                            );
                            toast.push(t("地址已复制"));
                          }}
                        >
                          <Copy size={14} aria-hidden="true" />
                          {t("复制")}
                        </Button>
                      </div>
                      {remoteAccess.addresses.map((address) => (
                        <div className={styles.remoteAddress} key={address.url}>
                          <span>
                            {remoteAddressLabel(address.kind)}
                            {address.secure ? (
                              <small>{t("HTTPS")}</small>
                            ) : null}
                          </span>
                          <code>{address.url}</code>
                        </div>
                      ))}
                      <span className={styles.tailscaleState}>
                        {remoteAccess.tailscale.running
                          ? remoteAccess.tailscale.serveUrl
                            ? t("Tailscale HTTPS 已就绪")
                            : t("Tailscale 已连接，尚未配置 Serve HTTPS")
                          : remoteAccess.tailscale.installed
                            ? t("Tailscale 未连接")
                            : t("未检测到 Tailscale")}
                      </span>
                    </div>
                    {remoteAccess.security.warnings.map((warning) => (
                      <div className={styles.remoteWarning} key={warning}>
                        <AlertTriangle size={15} aria-hidden="true" />
                        <span>{remoteWarningLabel(warning)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span>{t("无法检测远程入口")}</span>
                )}
              </article>

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
                      ok={doctor.pi.compatible}
                      label={`${t("Pi 兼容性")} ≥ ${doctor.pi.minimumVersion}`}
                    />
                    <DoctorLine
                      ok={doctor.pi.rpcStartable}
                      label={`${t("Pi RPC 握手")} · ${doctor.pi.rpcCommands.join(", ") || t("不可用")}`}
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
    </>
  );
}

function remoteAddressLabel(
  kind: RemoteAccessInfo["addresses"][number]["kind"]
): string {
  if (kind === "tailscale-https") return t("Tailscale HTTPS");
  if (kind === "tailscale-ip") return t("Tailscale IP");
  if (kind === "lan") return t("局域网地址");
  return t("当前连接");
}

function remoteWarningLabel(warning: string): string {
  if (warning.startsWith("The preferred remote address uses plain HTTP")) {
    return t("首选远程地址使用明文 HTTP，只应在可信私有网络中使用，或配置 HTTPS 反向代理。");
  }
  if (warning === "Secure cookies are explicitly disabled.") {
    return t("Secure Cookie 已被明确禁用。");
  }
  if (warning.startsWith("Trusted proxy mode is enabled")) {
    return t("已启用 Trusted Proxy，但当前请求未被识别为 HTTPS，请检查转发头配置。");
  }
  return warning;
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
