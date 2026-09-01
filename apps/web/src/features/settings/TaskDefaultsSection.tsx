import { FolderCog, Settings2, Wrench } from "lucide-react";
import type { PiWebSettings, ThinkingLevel } from "@pi-web/protocol";
import { t } from "../../i18n";
import { ModelSelect } from "../../ModelSelect";
import { ThinkingLevelControl } from "../../ThinkingLevelControl";
import styles from "../../pages/SettingsPage.module.css";
import { ToggleRow } from "./ToggleRow";

export function TaskDefaultsSection({
  settings,
  roots,
  onChange,
  onRootsChange,
  onError
}: {
  settings: PiWebSettings;
  roots: string;
  onChange: (settings: PiWebSettings) => void;
  onRootsChange: (roots: string) => void;
  onError: (error: unknown) => void;
}) {
  return (
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
                <div className={styles.field}>
                  <span>{t("默认模型")}</span>
                  <ModelSelect
                    value={settings.defaultModel ?? ""}
                    onChange={(next) =>
                      onChange({
                        ...settings,
                        defaultModel: next || null
                      })
                    }
                    onError={onError}
                  />
                </div>
                <div className={styles.field}>
                  <span>{t("默认思考级别")}</span>
                  <ThinkingLevelControl
                    value={settings.defaultThinkingLevel ?? ""}
                    allowDefault
                    onChange={(next) =>
                      onChange({
                        ...settings,
                        defaultThinkingLevel: (next || null) as ThinkingLevel | null
                      })
                    }
                  />
                </div>
              </div>
              <label className={styles.field}>
                <span>{t("默认附加系统提示词")}</span>
                <textarea
                  rows={5}
                  value={settings.defaultSystemPrompt ?? ""}
                  onChange={(event) =>
                    onChange({
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
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={settings.piExecutable}
                    onChange={(event) =>
                      onChange({
                        ...settings,
                        piExecutable: event.target.value
                      })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>{t("默认时区")}</span>
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={settings.defaultTimezone}
                    onChange={(event) =>
                      onChange({
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
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  rows={4}
                  value={roots}
                  onChange={(event) => onRootsChange(event.target.value)}
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
                  onChange({ ...settings, allowAnyDirectory: checked })
                }
              />
            </div>
          </section>

  );
}
