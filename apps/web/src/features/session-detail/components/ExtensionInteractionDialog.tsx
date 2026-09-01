import type { PendingExtensionInteraction } from "@pi-web/protocol";
import { useEffect, useId, useState } from "react";
import { api, jsonBody } from "../../../api";
import { createMutationId } from "../../../mutation-id";
import { Button, Dialog } from "../../../components";
import { t } from "../../../i18n";
import { ui } from "../../../ui";

interface ExtensionInteractionDialogProps {
  sessionId: string;
  interaction: PendingExtensionInteraction | null;
  onError: (error: unknown) => void;
  onResolved: () => Promise<void>;
}

export function ExtensionInteractionDialog({
  sessionId,
  interaction,
  onError,
  onResolved
}: ExtensionInteractionDialogProps) {
  const titleId = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(
      interaction?.method === "editor"
        ? interaction.prefill ?? ""
        : ""
    );
    setBusy(false);
  }, [interaction?.id, interaction?.method, interaction?.prefill]);

  if (!interaction) return null;

  const currentInteraction = interaction;

  async function respond(response: {
    cancelled?: boolean;
    confirmed?: boolean;
    value?: string;
  }) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/extension-ui`, {
        method: "POST",
        ...jsonBody({
          mutationId: createMutationId(),
          interactionId: currentInteraction.id,
          ...response
        })
      });
      await onResolved();
    } catch (error) {
      setBusy(false);
      onError(error);
    }
  }

  const cancel = () => void respond({ cancelled: true });

  return (
    <Dialog
      open
      labelledBy={titleId}
      onClose={cancel}
      className={ui("extension-interaction-dialog")}
      maxWidth={560}
    >
      <div className={ui("dialog-heading")}>
        <div>
          <p className={ui("eyebrow")}>EXTENSION REQUEST</p>
          <h2 id={titleId}>{interaction.title}</h2>
        </div>
      </div>

      {interaction.message && (
        <p className={ui("extension-interaction-message")}>{interaction.message}</p>
      )}

      {interaction.method === "select" && (
        <div
          className={ui("extension-interaction-options")}
          role="radiogroup"
          aria-label={interaction.title}
        >
          {interaction.options.map((option) => (
            <label key={option} className={ui("extension-interaction-option")}>
              <input
                type="radio"
                name={`extension-interaction-${interaction.id}`}
                value={option}
                checked={value === option}
                onChange={() => setValue(option)}
                disabled={busy}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}

      {interaction.method === "input" && (
        <input
          autoFocus
          className={ui("input extension-interaction-input")}
          value={value}
          placeholder={interaction.placeholder ?? ""}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
      )}

      {interaction.method === "editor" && (
        <textarea
          autoFocus
          className={ui("input extension-interaction-editor")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
          rows={10}
        />
      )}

      <div className={ui("dialog-actions")}>
        <Button type="button" variant="secondary" onClick={cancel} disabled={busy}>
          {t("取消")}
        </Button>
        {interaction.method === "confirm" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void respond({ confirmed: false })}
              disabled={busy}
            >
              {t("拒绝")}
            </Button>
            <Button
              type="button"
              onClick={() => void respond({ confirmed: true })}
              disabled={busy}
            >
              {busy ? t("提交中…") : t("确认")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            onClick={() => void respond({ value })}
            disabled={busy || (interaction.method === "select" && !value)}
          >
            {busy ? t("提交中…") : t("提交")}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
