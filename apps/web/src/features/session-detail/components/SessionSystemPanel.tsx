import type { SessionSnapshot } from "@pi-web/protocol";
import { asRecord } from "../utils/session-parsing";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

export function SessionSystemPanel({
  snapshot
}: {
  snapshot: SessionSnapshot;
}) {
  const { session } = snapshot;
  const state = asRecord(snapshot.state);
  const liveSystemPrompt =
    typeof state.systemPrompt === "string" ? state.systemPrompt : null;

  return (
    <div className={ui("workbench-system-panel")}>
      <div>
        <strong>{t("模型")}</strong>
        <span>{session.model ?? t("Pi 默认模型")}</span>
      </div>
      <div>
        <strong>{t("工作目录")}</strong>
        <span title={session.cwd}>{session.cwd}</span>
      </div>
      <div>
        <strong>{t("会话 ID")}</strong>
        <span>{session.id}</span>
      </div>
      <div className={ui("workbench-system-prompt")}>
        <strong>{t("实际生效的系统提示词")}</strong>
        {liveSystemPrompt !== null ? (
          <pre>{liveSystemPrompt || t("Pi 未返回系统提示词")}</pre>
        ) : (
          <span>
            {t("当前 Pi 版本或已关闭的会话没有返回该值。配置的附加内容：")}
            {session.systemPrompt || t("无")}
          </span>
        )}
      </div>
    </div>
  );
}
