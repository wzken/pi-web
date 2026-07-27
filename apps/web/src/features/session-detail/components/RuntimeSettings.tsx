import type { ThinkingLevel } from "@pi-web/protocol";
import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, jsonBody } from "../../../api";
import { Button } from "../../../components";
import { ModelSelect } from "../../../ModelSelect";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface RuntimeSettingsProps {
  sessionId: string;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  active: boolean;
  onError: (error: unknown) => void;
  onUpdated: () => Promise<void>;
}

export function RuntimeSettings({
  sessionId,
  model,
  thinkingLevel,
  active,
  onError,
  onUpdated
}: RuntimeSettingsProps) {
  const [modelValue, setModelValue] = useState(model ?? "");
  const [thinkingValue, setThinkingValue] = useState<ThinkingLevel>(
    thinkingLevel ?? "medium"
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => setModelValue(model ?? ""), [model]);
  useEffect(
    () => setThinkingValue(thinkingLevel ?? "medium"),
    [thinkingLevel]
  );

  async function update(path: "model" | "thinking", body: unknown) {
    setBusy(true);
    try {
      await api(`/api/sessions/${sessionId}/${path}`, {
        method: "PUT",
        ...jsonBody(body)
      });
      await onUpdated();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={ui("runtime-settings")}>
      <summary>
        <Settings2 size={13} />
        {model ?? t("Pi 默认模型")}
      </summary>
      <div className={ui("runtime-settings-popover")}>
        <div className={ui("field")}>
          <span>{t("模型")}</span>
          <ModelSelect
            value={modelValue}
            onChange={setModelValue}
            disabled={!active || busy}
            onError={onError}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          title={t("应用模型")}
          disabled={!active || busy || !modelValue.trim()}
          onClick={() => void update("model", { model: modelValue.trim() })}
        >
          {t("应用模型")}
        </Button>
        <label className={ui("field")}>
          <span>{t("思考级别")}</span>
          <select
            value={thinkingValue}
            disabled={!active || busy}
            onChange={(event) => {
              const next = event.target.value as ThinkingLevel;
              setThinkingValue(next);
              void update("thinking", { thinkingLevel: next });
            }}
          >
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
              (level) => (
                <option key={level}>{level}</option>
              )
            )}
          </select>
        </label>
        {!active && <small>{t("先恢复会话，才能修改运行参数。")}</small>}
      </div>
    </details>
  );
}
