import {
  useEffect,
  useId,
  useState,
  type KeyboardEventHandler
} from "react";
import type { PiStatus } from "@pi-web/protocol";
import { api } from "./api";
import { isCacheFresh } from "./cache-policy";
import { t } from "./i18n";
import { ui } from "./ui";

export const modelListTtlMs = 60_000;

let modelRequest: Promise<PiStatus["models"]> | null = null;
let modelCache: {
  models: PiStatus["models"];
  loadedAt: number;
} | null = null;

function loadModels(force = false) {
  if (
    !force &&
    modelCache &&
    isCacheFresh(modelCache.loadedAt, Date.now(), modelListTtlMs)
  ) {
    return Promise.resolve(modelCache.models);
  }
  modelRequest ??= api<PiStatus>("/api/pi")
    .then((status) => status.models)
    .then((models) => {
      modelCache = { models, loadedAt: Date.now() };
      return models;
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      modelRequest = null;
    });
  return modelRequest;
}

export function ModelSelect({
  value,
  disabled = false,
  className = "",
  onChange,
  onError,
  onKeyDown
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onError?: (error: unknown) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  const [models, setModels] = useState<PiStatus["models"]>([]);
  const suggestionsId = useId();

  useEffect(() => {
    let cancelled = false;
    const refresh = (force = false) => {
      void loadModels(force)
        .then((items) => {
          if (!cancelled) setModels(items);
        })
        .catch((error) => {
          if (!cancelled) onError?.(error);
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const handleFocus = () => refresh();
    const handleOnline = () => refresh(true);
    refresh();
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh(true);
    }, modelListTtlMs);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, [onError]);

  return (
    <>
      <input
        className={ui(className)}
        list={suggestionsId}
        value={value}
        disabled={disabled}
        aria-label={t("模型")}
        placeholder={t("Pi 默认模型")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <datalist id={suggestionsId}>
        {models.map((model) => {
          const modelValue = `${model.provider}/${model.id}`;
          return (
            <option
              key={modelValue}
              value={modelValue}
              label={`${model.label || model.id} · ${model.provider}`}
            />
          );
        })}
      </datalist>
    </>
  );
}
