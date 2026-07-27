import type { QueuedMessages } from "@pi-web/protocol";
import { CornerDownRight, ListTodo } from "lucide-react";
import styles from "./QueuedMessagesPanel.module.css";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

export function QueuedMessagesPanel({
  queuedMessages
}: {
  queuedMessages: QueuedMessages;
}) {
  const items = [
    ...queuedMessages.steering.map((text) => ({
      kind: "steer" as const,
      text
    })),
    ...queuedMessages.followUp.map((text) => ({
      kind: "follow-up" as const,
      text
    }))
  ];
  if (items.length === 0) return null;

  return (
    <section className={ui(styles.root)} aria-label={t("已排队消息")}>
      <header>
        <ListTodo size={13} />
        <strong>{t("已排队")}</strong>
        <span>{items.length}</span>
      </header>
      <div className={ui(styles.list)}>
        {items.map((item, index) => (
          <div
            className={ui(`${styles.message} ${
              item.kind === "steer" ? styles.steer : styles.followUp
            }`)}
            key={`${item.kind}-${index}-${item.text}`}
          >
            <CornerDownRight size={12} />
            <span className={ui(styles.kind)}>
              {item.kind === "steer" ? t("立即引导") : t("完成后")}
            </span>
            <span className={ui(styles.text)} title={item.text}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
