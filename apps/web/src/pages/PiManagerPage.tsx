import {
  AlertTriangle,
  Bot,
  Box,
  Braces,
  CheckCircle2,
  Download,
  FileCode2,
  Package,
  RefreshCcw,
  Sparkles,
  Trash2,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, isAbortError, jsonBody } from "../api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  useToast
} from "../components";
import { t } from "../i18n";
import { ui } from "../ui";

interface ResourceItem {
  name: string;
  path: string;
  location: "user";
}

interface PiStatus {
  available: boolean;
  executable: string;
  version: string | null;
  models: Array<{ provider: string; id: string; label: string }>;
  providers: Array<{ id: string; configured: boolean; modelCount: number }>;
  packages: string[];
  skills: ResourceItem[];
  extensions: ResourceItem[];
  templates: ResourceItem[];
  errors: string[];
}

export function PiManagerPage() {
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [tab, setTab] = useState<"models" | "packages" | "resources">("models");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();

  const refresh = useCallback(
    (signal?: AbortSignal) =>
      api<PiStatus>("/api/pi", signal ? { signal } : {})
        .then(setStatus)
        .catch((reason) => {
          if (!isAbortError(reason)) setError(reason);
        }),
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function packageAction(
    action: "install" | "remove" | "update_all",
    value?: string
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/pi/packages", {
        method: "POST",
        ...jsonBody({ action, source: value })
      });
      toast.push(
        action === "install"
          ? t("Package 已安装；新会话会加载它")
          : action === "remove"
            ? t("Package 已移除")
            : t("Pi Packages 已更新")
      );
      setSource("");
      await refresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  if (error && !status) return <ErrorBanner error={error} />;
  if (!status) return <Loading label={t("询问 Pi 当前能力")} />;

  const resources = [
    { label: "Skills", values: status.skills, icon: Sparkles },
    { label: "Extensions", values: status.extensions, icon: Braces },
    { label: "Prompt Templates", values: status.templates, icon: FileCode2 }
  ];

  return (
    <>
      <header className={ui("page-header")}>
        <div>
          <p className={ui("eyebrow")}>PI MANAGER</p>
          <h1>{t("Pi 管理")}</h1>
          <p>{t("展示 Pi 自己发现的模型、Packages、Skills、Extensions 和模板。")}</p>
        </div>
        <Button
          variant="secondary"
          loading={refreshing}
          loadingLabel={t("刷新中…")}
          onClick={() => {
            setRefreshing(true);
            void refresh().finally(() => setRefreshing(false));
          }}
        >
          <RefreshCcw size={16} />
          {t("刷新状态")}
        </Button>
      </header>
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <section className={ui(`pi-runtime-banner ${status.available ? "available" : "missing"}`)}>
        <div className={ui("pi-runtime-icon")}><Bot size={24} /></div>
        <div>
          <span>PI CODING AGENT</span>
          <h2>{status.available ? status.version || t("版本未知") : t("未找到 Pi")}</h2>
          <p>{status.executable}</p>
        </div>
        <div className={ui("runtime-state")}>
          {status.available ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
          {status.available ? t("可用") : t("不可用")}
        </div>
      </section>

      {status.errors.length > 0 && (
        <div className={ui("manager-errors")}>
          <AlertTriangle size={18} />
          <div>
            <strong>{t("部分 Pi 状态无法读取")}</strong>
            {status.errors.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
      )}

      <div className={ui("tabs")} role="tablist" aria-label={t("Pi 管理类别")}>
        <Button variant="toolbar" role="tab" aria-selected={tab === "models"} active={tab === "models"} onClick={() => setTab("models")}>{t("模型与 Provider")}</Button>
        <Button variant="toolbar" role="tab" aria-selected={tab === "packages"} active={tab === "packages"} onClick={() => setTab("packages")}>Packages</Button>
        <Button variant="toolbar" role="tab" aria-selected={tab === "resources"} active={tab === "resources"} onClick={() => setTab("resources")}>{t("能力资源")}</Button>
      </div>

      {tab === "models" && (
        <section className={ui("manager-grid")}>
          <article className={ui("panel")}>
            <div className={ui("panel-heading")}><div><p className={ui("eyebrow")}>PROVIDERS</p><h2>{t("已配置 Provider")}</h2></div></div>
            {status.providers.length === 0 ? (
              <p className={ui("panel-empty")}>{t("Pi 没有返回可用模型；请先在 Pi 中完成 Provider 登录或 API Key 配置。")}</p>
            ) : (
              <div className={ui("provider-grid")}>
                {status.providers.map((provider) => (
                  <div className={ui("provider-card")} key={provider.id}>
                    <div className={ui("provider-avatar")}>{provider.id.slice(0, 2).toUpperCase()}</div>
                    <div><strong>{provider.id}</strong><span>{t("{{count}} 个模型", { count: provider.modelCount })}</span></div>
                    <CheckCircle2 size={16} />
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className={ui("panel")}>
            <div className={ui("panel-heading")}><div><p className={ui("eyebrow")}>MODELS</p><h2>{t("可用模型")}</h2></div><span>{status.models.length}</span></div>
            <div className={ui("model-list")}>
              {status.models.map((model) => (
                <div key={`${model.provider}/${model.id}`}>
                  <div className={ui("model-dot")} />
                  <span>{model.id}</span>
                  <small>{model.provider}</small>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {tab === "packages" && (
        <section className={ui("packages-layout")}>
          <article className={ui("panel package-install")}>
            <p className={ui("eyebrow")}>INSTALL PACKAGE</p>
            <h2>{t("安装 Pi Package")}</h2>
            <div className={ui("package-warning")}>
              <AlertTriangle size={17} />
              <span>{t("Pi Package 可以执行代码并影响 Agent 行为，只安装你信任的来源。")}</span>
            </div>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void packageAction("install", source);
              }}
            >
              <label className={ui("field")}>
                <span>{t("Package 来源")}</span>
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="npm:@scope/package@version"
                />
              </label>
              <Button disabled={!source} loading={busy} loadingLabel={t("安装中…")}><Download size={16} />{t("安装")}</Button>
            </form>
            <small>{t("支持官方定义的 npm:、git:、URL 或绝对本地路径。")}</small>
          </article>
          <article className={ui("panel")}>
            <div className={ui("panel-heading")}>
              <div><p className={ui("eyebrow")}>INSTALLED</p><h2>{t("已安装 Packages")}</h2></div>
              <Button variant="secondary" loading={busy} loadingLabel={t("更新中…")} onClick={() => void packageAction("update_all")}>
                <RefreshCcw size={15} />{t("全部更新")}
              </Button>
            </div>
            {status.packages.length === 0 ? (
              <EmptyState icon={<Package size={24} />} title={t("没有已登记的 Package")}>{t("Pi 的 list 命令未返回任何 Package。")}</EmptyState>
            ) : (
              <div className={ui("package-list")}>
                {status.packages.map((item) => (
                  <div key={item}>
                    <div className={ui("package-icon")}><Box size={17} /></div>
                    <span>{item}</span>
                    <IconButton label={t("移除 {{name}}", { name: item })} variant="danger" disabled={busy} onClick={() => void packageAction("remove", item)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <p className={ui("manager-note")}>{t("当前 Pi 只公开批量更新 Packages；运行中的 Worker 可能需要新建或重启会话才会加载变化。")}</p>
          </article>
        </section>
      )}

      {tab === "resources" && (
        <section className={ui("resource-columns")}>
          {resources.map(({ label, values, icon: Icon }) => (
            <article className={ui("panel")} key={label}>
              <div className={ui("panel-heading")}>
                <div><p className={ui("eyebrow")}>{label.toUpperCase()}</p><h2>{label}</h2></div>
                <span>{values.length}</span>
              </div>
              <div className={ui("resource-list")}>
                {values.length === 0 ? (
                  <p className={ui("panel-empty")}>{t("未发现资源。")}</p>
                ) : (
                  values.map((resource) => (
                    <div key={resource.path} title={resource.path}>
                      <Icon size={15} />
                      <span>{resource.name}</span>
                      <small>{resource.location}</small>
                    </div>
                  ))
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
