import type { ThinkingLevel } from "@pi-web/protocol";
import { Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, jsonBody } from "../../../api";
import { Button, Dialog, IconButton } from "../../../components";
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setModelValue(model ?? ""), [model]);
  useEffect(
    () => setThinkingValue(thinkingLevel ?? "medium"),
    [thinkingLevel]
  );

  const normalizedModel = modelValue.trim();
  const modelChanged = Boolean(normalizedModel) && normalizedModel !== model;
  const thinkingChanged = thinkingValue !== (thinkingLevel ?? "medium");

  async function apply() {
    if (!active || busy || (!modelChanged && !thinkingChanged)) return;
    setBusy(true);
    try {
      if (modelChanged) {
        await api(`/api/sessions/${sessionId}/model`, {
          method: "PUT",
          ...jsonBody({ model: normalizedModel })
        });
      }
      if (thinkingChanged) {
        await api(`/api/sessions/${sessionId}/thinking`, {
          method: "PUT",
          ...jsonBody({ thinkingLevel: thinkingValue })
        });
      }
      await onUpdated();
      setOpen(false);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={ui("runtime-settings")}>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className={ui("runtime-settings-trigger")}
        active={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("设置当前会话的模型和思考级别")}
        title={t("模型与思考级别")}
        onClick={() => setOpen(true)}
      >
        <Settings2 size={13} />
        <span>{shortModelName(model) || t("默认模型")}</span>
      </Button>

      <Dialog
        open={open}
        labelledBy="session-runtime-title"
        className={ui("runtime-config-dialog session-runtime-dialog")}
        maxWidth={520}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <div>
          <header className={ui("dialog-heading runtime-config-heading")}>
            <div>
              <p className={ui("eyebrow")}>SESSION RUNTIME</p>
              <h2 id="session-runtime-title">{t("模型与思考级别")}</h2>
              <span>{t("修改当前会话后续请求使用的运行参数。")}</span>
            </div>
            <IconButton
              label={t("关闭模型设置")}
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </header>

          <div className={ui("runtime-config-grid")}>
            <label className={ui("field")}>
              <span>{t("模型")}</span>
              <ModelSelect
                value={modelValue}
                onChange={setModelValue}
                disabled={!active || busy}
                onError={onError}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
              />
            </label>
            <label className={ui("field")}>
              <span>{t("思考级别")}</span>
              <select
                value={thinkingValue}
                disabled={!active || busy}
                aria-label={t("思考级别")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) =>
                  setThinkingValue(event.target.value as ThinkingLevel)
                }
              >
                {[
                  "off",
                  "minimal",
                  "low",
                  "medium",
                  "high",
                  "xhigh",
                  "max"
                ].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            {!active && (
              <p className={ui("runtime-config-note")}>
                {t("先恢复会话，才能修改运行参数。")}
              </p>
            )}
          </div>

          <footer className={ui("dialog-actions runtime-config-actions")}>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("取消")}
            </Button>
            <Button
              type="button"
              loading={busy}
              loadingLabel={t("应用中…")}
              disabled={
                !active ||
                (!modelChanged && !thinkingChanged) ||
                (modelValue.length > 0 && !normalizedModel)
              }
              onClick={() => void apply()}
            >
              {t("应用")}
            </Button>
          </footer>
        </div>
      </Dialog>
    </div>
  );
}

function shortModelName(model: string | null): string {
  if (!model) return "";
  return model.split("/").at(-1) ?? model;
}
