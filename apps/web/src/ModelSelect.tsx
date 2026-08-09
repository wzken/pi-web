import {
  Check,
  ChevronDown,
  Search
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEventHandler
} from "react";
import { createPortal } from "react-dom";
import type { PiStatus } from "@pi-web/protocol";
import { api } from "./api";
import { isCacheFresh } from "./cache-policy";
import { t } from "./i18n";
import { ui } from "./ui";

const modelListTtlMs = 60_000;

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
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const suppressNextFocusOpen = useRef(false);
  const listboxId = useId();

  useEffect(() => {
    let cancelled = false;
    const refresh = (force = false) => {
      setLoading(true);
      void loadModels(force)
        .then((items) => {
          if (!cancelled) setModels(items);
        })
        .catch((error) => {
          if (!cancelled) onError?.(error);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
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
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onError]);

  const orderedModels = useMemo(() => {
    const unique = new Map<string, PiStatus["models"][number]>();
    for (const model of models) {
      unique.set(`${model.provider}/${model.id}`, model);
    }
    return [...unique.values()].sort((left, right) =>
      left.provider.localeCompare(right.provider) ||
      (left.label || left.id).localeCompare(right.label || right.id)
    );
  }, [models]);

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return orderedModels;
    return orderedModels.filter((model) =>
      `${model.provider}/${model.id} ${model.label}`
        .toLocaleLowerCase()
        .includes(normalized)
    );
  }, [orderedModels, query]);
  const showDefaultOption = query.trim().length === 0;
  const optionValues = useMemo(
    () => [
      ...(showDefaultOption ? [""] : []),
      ...filteredModels.map((model) => `${model.provider}/${model.id}`)
    ],
    [filteredModels, showDefaultOption]
  );

  const updatePopupPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(
      Math.max(rect.width, 380),
      window.innerWidth - viewportPadding * 2
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding
    );
    const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
    const roomAbove = rect.top - viewportPadding;
    const placeAbove = roomBelow < 220 && roomAbove > roomBelow;
    const maxHeight = Math.max(180, Math.min(360, placeAbove ? roomAbove - 8 : roomBelow - 8));
    setPopupStyle({
      left,
      top: placeAbove ? undefined : rect.bottom + 6,
      bottom: placeAbove ? window.innerHeight - rect.top + 6 : undefined,
      width,
      maxHeight
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePopupPosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
      setActiveOptionIndex(null);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      setQuery("");
      setActiveOptionIndex(null);
      suppressNextFocusOpen.current = true;
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    const reposition = () => updatePopupPosition();
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, updatePopupPosition]);

  function choose(nextValue: string) {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
    setActiveOptionIndex(null);
    suppressNextFocusOpen.current = true;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openList() {
    if (disabled) return;
    setQuery("");
    const selected = optionValues.indexOf(value);
    setActiveOptionIndex(selected >= 0 ? selected : null);
    setOpen(true);
  }

  const popup = open ? (
    <div
      ref={popupRef}
      id={listboxId}
      className={ui("model-select-popover")}
      style={popupStyle}
      role="listbox"
      aria-label={t("可用模型")}
    >
      <div className={ui("model-select-popover-heading")}>
        <span>{t("选择模型")}</span>
        <small>{filteredModels.length}</small>
      </div>
      {showDefaultOption && (
        <button
          id={`${listboxId}-option-0`}
          type="button"
          className={ui(
            `model-option${value ? "" : " is-selected"}${activeOptionIndex === 0 ? " is-active" : ""}`
          )}
          role="option"
          tabIndex={-1}
          aria-selected={!value}
          onClick={() => choose("")}
          onPointerEnter={() => setActiveOptionIndex(0)}
        >
          <span className={ui("model-option-main")}>
            <strong>{t("Pi 默认模型")}</strong>
            <small>{t("跟随全局设置")}</small>
          </span>
          {!value && <Check size={16} aria-hidden="true" />}
        </button>
      )}
      {loading && orderedModels.length === 0 ? (
        <p className={ui("model-select-empty")}>{t("正在读取模型…")}</p>
      ) : filteredModels.length === 0 ? (
        <p className={ui("model-select-empty")}>{t("没有匹配的模型")}</p>
      ) : (
        groupModels(filteredModels).map(([provider, providerModels]) => (
          <section className={ui("model-provider-group")} key={provider}>
            <div className={ui("model-provider-heading")}>
              <span>{provider}</span>
              <small>{providerModels.length}</small>
            </div>
            {providerModels.map((model) => {
              const modelValue = `${model.provider}/${model.id}`;
              const selected = value === modelValue;
              const optionIndex = optionValues.indexOf(modelValue);
              return (
                <button
                  id={`${listboxId}-option-${optionIndex}`}
                  type="button"
                  className={ui(
                    `model-option${selected ? " is-selected" : ""}${activeOptionIndex === optionIndex ? " is-active" : ""}`
                  )}
                  key={modelValue}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  title={modelValue}
                  onClick={() => choose(modelValue)}
                  onPointerEnter={() => setActiveOptionIndex(optionIndex)}
                >
                  <span className={ui("model-option-main")}>
                    <strong>{model.id}</strong>
                    <small>{modelValue}</small>
                  </span>
                  {selected && <Check size={16} aria-hidden="true" />}
                </button>
              );
            })}
          </section>
        ))
      )}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={ui(`model-select${open ? " is-open" : ""}`)}>
      <Search className={ui("model-select-search-icon")} size={15} aria-hidden="true" />
      <input
        ref={inputRef}
        className={ui(className, "model-select-input")}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-label={t("模型")}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={
          open && activeOptionIndex !== null
            ? `${listboxId}-option-${activeOptionIndex}`
            : undefined
        }
        placeholder={t("搜索或输入模型")}
        onFocus={() => {
          if (suppressNextFocusOpen.current) {
            suppressNextFocusOpen.current = false;
            return;
          }
          openList();
        }}
        onClick={openList}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          setActiveOptionIndex(null);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setQuery("");
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) setOpen(true);
            if (optionValues.length === 0) {
              setActiveOptionIndex(null);
              onKeyDown?.(event);
              return;
            }
            setActiveOptionIndex((current) => {
              if (event.key === "Home") return 0;
              if (event.key === "End") return optionValues.length - 1;
              if (current === null) {
                const selected = optionValues.indexOf(value);
                return selected >= 0 ? selected : 0;
              }
              return event.key === "ArrowUp"
                ? (current - 1 + optionValues.length) % optionValues.length
                : (current + 1) % optionValues.length;
            });
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (activeOptionIndex === null) {
              setOpen(false);
              setQuery("");
            } else {
              choose(optionValues[activeOptionIndex] ?? "");
            }
          }
          onKeyDown?.(event);
        }}
      />
      <button
        type="button"
        className={ui("model-select-toggle")}
        disabled={disabled}
        aria-label={open ? t("关闭模型列表") : t("打开模型列表")}
        aria-expanded={open}
        aria-controls={listboxId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false);
            setQuery("");
            setActiveOptionIndex(null);
          } else {
            openList();
            inputRef.current?.focus();
          }
        }}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {typeof document !== "undefined" && popup
        ? createPortal(popup, document.body)
        : null}
    </div>
  );
}

function groupModels(
  models: PiStatus["models"]
): Array<[string, PiStatus["models"]]> {
  const groups = new Map<string, PiStatus["models"]>();
  for (const model of models) {
    const items = groups.get(model.provider) ?? [];
    items.push(model);
    groups.set(model.provider, items);
  }
  return [...groups.entries()];
}
