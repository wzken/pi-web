import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorBanner, useToast } from "../../components";
import { t } from "../../i18n";
import { LanguageSettings } from "../../i18n/LanguageSettings";
import {
  loadNotificationPreferences,
  playCompletionSound,
  saveNotificationPreferences,
  type NotificationPreferences
} from "../../notifications";
import {
  disablePushNotifications,
  enablePushNotifications,
  pushAvailable,
  readPushState,
  sendTestPush,
  type PushState
} from "../../push-notifications";
import styles from "../../pages/SettingsPage.module.css";
import { ToggleRow } from "./ToggleRow";

export function PreferencesSection() {
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pushState, setPushState] = useState<PushState>(() => ({
    supported: pushAvailable(),
    permission:
      typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission,
    subscribed: false
  }));
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(loadNotificationPreferences);
  const toast = useToast();

  useEffect(() => {
    void readPushState().then(setPushState).catch(setError);
  }, []);

  async function togglePushNotifications(enabled: boolean) {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const next = enabled
        ? await enablePushNotifications()
        : await disablePushNotifications();
      setPushState(next);
      if (enabled && !next.subscribed) {
        toast.push(
          next.permission === "unsupported"
            ? t("当前浏览器不支持后台推送")
            : t("浏览器未授予通知权限"),
          "error"
        );
      } else {
        toast.push(enabled ? t("后台推送已启用") : t("后台推送已停用"));
      }
    } catch (reason) {
      setError(reason);
    } finally {
      setPushBusy(false);
    }
  }

  async function testPushNotifications() {
    if (pushTestBusy) return;
    setPushTestBusy(true);
    try {
      await sendTestPush();
      toast.push(t("测试推送已发送"));
    } catch (reason) {
      setError(reason);
    } finally {
      setPushTestBusy(false);
    }
  }

  function toggleCompletionSound(enabled: boolean) {
    const next = { ...notificationPreferences, sound: enabled };
    setNotificationPreferences(next);
    saveNotificationPreferences(next);
    if (enabled) playCompletionSound();
  }

  return (
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

            {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

            <div className={styles.toggleList}>
              <ToggleRow
                label={t("后台推送")}
                description={t(
                  "Pi Web 关闭或位于后台时，仍可接收等待决策、完成和异常通知。"
                )}
                checked={pushState.subscribed}
                disabled={!pushState.supported || pushBusy}
                onChange={(checked) => void togglePushNotifications(checked)}
              />
              {pushState.subscribed ? (
                <div className={styles.notificationTestRow}>
                  <span>
                    <strong>{t("当前设备已订阅")}</strong>
                    <small>{t("锁屏内容只显示事件类型和会话名称。")}</small>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={pushTestBusy}
                    loadingLabel={t("发送中…")}
                    onClick={() => void testPushNotifications()}
                  >
                    {t("发送测试推送")}
                  </Button>
                </div>
              ) : null}
              {!pushState.supported ? (
                <p className={styles.inlineWarning}>
                  {t("当前浏览器不支持后台推送。")}
                </p>
              ) : pushState.permission === "denied" ? (
                <p className={styles.inlineWarning}>
                  {t("通知权限已被浏览器阻止，请在站点设置中重新允许。")}
                </p>
              ) : null}
              <ToggleRow
                label={t("完成提示音")}
                description={t(
                  "页面打开时使用浏览器本地生成的短提示音，不加载外部音频。"
                )}
                checked={notificationPreferences.sound}
                onChange={toggleCompletionSound}
              />
            </div>
          </section>

  );
}
