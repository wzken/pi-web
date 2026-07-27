import { useEffect, useState } from "react";
import { api } from "./api";
import { t } from "./i18n";
import { ui } from "./ui";

interface PiStatus {
  models: Array<{ provider: string; id: string; label: string }>;
}

let modelRequest: Promise<PiStatus["models"]> | null = null;

function loadModels() {
  modelRequest ??= api<PiStatus>("/api/pi")
    .then((status) => status.models)
    .catch((error) => {
      modelRequest = null;
      throw error;
    });
  return modelRequest;
}

export function ModelSelect({
  value,
  disabled = false,
  className = "",
  onChange,
  onError
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onError?: (error: unknown) => void;
}) {
  const [models, setModels] = useState<PiStatus["models"]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadModels()
      .then((items) => {
        if (!cancelled) setModels(items);
      })
      .catch((error) => {
        if (!cancelled) onError?.(error);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const values = new Set(models.map((model) => `${model.provider}/${model.id}`));
  return (
    <select
      className={ui(className)}
      value={value}
      disabled={disabled}
      aria-label={t("模型")}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("Pi 默认模型")}</option>
      {value && !values.has(value) && <option value={value}>{value}</option>}
      {models.map((model) => {
        const modelValue = `${model.provider}/${model.id}`;
        return (
          <option key={modelValue} value={modelValue}>
            {model.label || model.id} · {model.provider}
          </option>
        );
      })}
    </select>
  );
}
