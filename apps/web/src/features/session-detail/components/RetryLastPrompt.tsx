import { AlertOctagon, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { api, jsonBody } from "../../../api";
import { Button } from "../../../components";
import type { RetryablePrompt } from "../../../session-messages";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface RetryLastPromptProps {
  sessionId: string;
  prompt: RetryablePrompt;
  onError: (error: unknown) => void;
  onRetried: () => Promise<void>;
}

export function RetryLastPrompt({
  sessionId,
  prompt,
  onError,
  onRetried
}: RetryLastPromptProps) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}/resume`, {
        method: "POST",
        ...jsonBody(prompt)
      });
      await onRetried();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ui("session-retry")} role="status">
      <AlertOctagon size={16} />
      <div>
        <strong>{t("上一条指令未得到回复")}</strong>
        <span>{t("恢复 Pi Worker，并重新发送最后一条用户指令。")}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={busy}
        loadingLabel={t("重试中…")}
        onClick={() => void retry()}
      >
        <RefreshCcw size={14} />
        {t("恢复并重试")}
      </Button>
    </div>
  );
}
