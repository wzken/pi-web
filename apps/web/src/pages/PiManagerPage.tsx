import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Box,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Package,
  RefreshCcw,
  Settings2,
  Sparkles,
  Terminal,
  Trash2,
  XCircle
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type { PiStatus, PiUpdateInfo } from "@pi-web/protocol";
import { ApiError, api, isAbortError, jsonBody } from "../api";
import {
  Button,
  EmptyState,
  ErrorBanner,
  IconButton,
  Loading,
  useToast
} from "../components";
import { t } from "../i18n";
import { useNavigate, useSearchParams } from "../router";
import { ui } from "../ui";
import styles from "./PiManagerPage.module.css";

type ManagerTab = "models" | "skills" | "packages";

const managerTabs: ManagerTab[] = ["models", "skills", "packages"];

export function PiManagerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: ManagerTab =
    requestedTab === "skills" || requestedTab === "packages"
      ? requestedTab
      : "models";
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [updateInfo, setUpdateInfo] = useState<PiUpdateInfo | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
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

  const checkUpdate = useCallback(async (force = false) => {
    setCheckingUpdate(true);
    try {
      setUpdateInfo(
        await api<PiUpdateInfo>(`/api/pi/update${force ? "?force=1" : ""}`)
      );
    } catch (reason) {
      setError(reason);
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    void checkUpdate();
  }, [checkUpdate]);

  function selectTab(nextTab: ManagerTab) {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "models") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next);
  }

  async function packageAction(
    action: "install" | "remove" | "update_all",
    value?: string
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let force = false;
      while (true) {
        try {
          await api("/api/pi/packages", {
            method: "POST",
            ...jsonBody({ action, source: value, force })
          });
          break;
        } catch (reason) {
          if (
            !force &&
            reason instanceof ApiError &&
            reason.code === "ACTIVE_WORKERS_BLOCK_PI_CHANGE" &&
            window.confirm(
              t(
                "仍有活动中的 Pi Worker。强制修改 Packages 可能使运行中的会话与新会话加载不同版本。仍要继续吗？"
              )
            )
          ) {
            force = true;
            continue;
          }
          throw reason;
        }
      }
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

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const currentIndex = managerTabs.indexOf(tab);
    const nextTab: ManagerTab =
      event.key === "Home"
        ? "models"
        : event.key === "End"
          ? "packages"
          : managerTabs[
              (currentIndex +
                (event.key === "ArrowLeft" ? -1 : 1) +
                managerTabs.length) %
                managerTabs.length
            ] ?? "models";
    selectTab(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`pi-${nextTab}-tab`)?.focus();
    });
  }

  if (error && !status) return <ErrorBanner error={error} />;
  if (!status) return <Loading label={t("读取 Pi 状态")} />;

  const providers = new Map<string, number>();
  for (const model of status.models) {
    providers.set(model.provider, (providers.get(model.provider) ?? 0) + 1);
  }
  const providerEntries = [...providers.entries()];

  return (
    <section className={ui(styles.page, "pi-manager-page")}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>PI RUNTIME</p>
          <h1>{t("Pi 管理")}</h1>
          <p>
            {t(
              "集中查看 Pi 运行状态，并管理模型、Skills 和 Packages。新会话默认值请在设置中调整。"
            )}
          </p>
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
          <RefreshCcw size={16} aria-hidden="true" />
          {t("刷新状态")}
        </Button>
      </header>

      {error !== null && (
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      )}

      <section
        className={styles.runtimeCard}
        data-available={String(status.available)}
        aria-labelledby="pi-runtime-title"
      >
        <div className={styles.runtimeSummary}>
          <div className={styles.runtimeIcon}>
            <Terminal size={23} aria-hidden="true" />
          </div>
          <div className={styles.runtimeCopy}>
            <div className={styles.runtimeState}>
              {status.available ? (
                <CheckCircle2 size={14} aria-hidden="true" />
              ) : (
                <XCircle size={14} aria-hidden="true" />
              )}
              {status.available ? t("可用") : t("不可用")}
            </div>
            <h2 id="pi-runtime-title">
              {status.available
                ? status.version || t("版本未知")
                : t("未找到 Pi")}
            </h2>
            <code title={status.executable}>{status.executable}</code>
          </div>
        </div>
        <dl className={styles.runtimeMetrics}>
          <div>
            <dt>
              <Cpu size={15} aria-hidden="true" />
              {t("模型")}
            </dt>
            <dd>{status.models.length}</dd>
          </div>
          <div>
            <dt>
              <Bot size={15} aria-hidden="true" />
              Provider
            </dt>
            <dd>{providers.size}</dd>
          </div>
          <div>
            <dt>
              <Sparkles size={15} aria-hidden="true" />
              Skills
            </dt>
            <dd>{status.skills.length}</dd>
          </div>
          <div>
            <dt>
              <Package size={15} aria-hidden="true" />
              Packages
            </dt>
            <dd>{status.packages.length}</dd>
          </div>
        </dl>
      </section>

      {updateInfo && (
        <aside
          className={styles.updateNotice}
          data-update-available={String(updateInfo.updateAvailable)}
          aria-live="polite"
        >
          <div>
            <span className={styles.updateIcon}>
              <RefreshCcw size={17} aria-hidden="true" />
            </span>
            <div>
              <strong>
                {updateInfo.updateAvailable
                  ? t("发现 Pi {{version}}", { version: updateInfo.latestVersion ?? "" })
                  : updateInfo.error
                    ? t("暂时无法检查 Pi 更新")
                    : t("Pi 已是最新版本")}
              </strong>
              <span>
                {updateInfo.updateAvailable
                  ? t("当前 {{current}}；请在服务器运行 pi update。", {
                      current: updateInfo.currentVersion ?? t("未知版本")
                    })
                  : updateInfo.error ||
                    t("已自动检查，后续打开 Pi 管理时会再次检查。")}
              </span>
            </div>
          </div>
          <div className={styles.updateActions}>
            {updateInfo.updateAvailable && (
              <a
                href={updateInfo.changelogUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("查看更新说明")}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              loading={checkingUpdate}
              loadingLabel={t("检查中…")}
              onClick={() => void checkUpdate(true)}
            >
              {t("重新检查")}
            </Button>
          </div>
        </aside>
      )}

      {status.errors.length > 0 && (
        <div className={styles.managerErrors} role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{t("部分 Pi 状态无法读取")}</strong>
            {status.errors.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
      )}

      <div
        className={styles.tabs}
        role="tablist"
        aria-label={t("Pi 管理类别")}
        tabIndex={0}
        onKeyDown={moveTab}
      >
        <Button
          id="pi-models-tab"
          variant="toolbar"
          role="tab"
          aria-controls="pi-models-panel"
          aria-selected={tab === "models"}
          tabIndex={tab === "models" ? 0 : -1}
          active={tab === "models"}
          onClick={() => selectTab("models")}
        >
          {t("模型与 Provider")}
        </Button>
        <Button
          id="pi-skills-tab"
          variant="toolbar"
          role="tab"
          aria-controls="pi-skills-panel"
          aria-selected={tab === "skills"}
          tabIndex={tab === "skills" ? 0 : -1}
          active={tab === "skills"}
          onClick={() => selectTab("skills")}
        >
          Skills
        </Button>
        <Button
          id="pi-packages-tab"
          variant="toolbar"
          role="tab"
          aria-controls="pi-packages-panel"
          aria-selected={tab === "packages"}
          tabIndex={tab === "packages" ? 0 : -1}
          active={tab === "packages"}
          onClick={() => selectTab("packages")}
        >
          Packages
        </Button>
      </div>

      {tab === "models" && (
        <section
          id="pi-models-panel"
          className={styles.managerGrid}
          role="tabpanel"
          aria-labelledby="pi-models-tab"
          tabIndex={0}
        >
          <aside className={styles.defaultsNotice}>
            <Settings2 size={18} aria-hidden="true" />
            <div>
              <strong>{t("新会话默认值已统一到设置")}</strong>
              <span>{t("模型、思考级别和附加系统提示词在设置中集中管理；当前会话仍可单独调整。")}</span>
            </div>
            <button
              type="button"
              className={styles.settingsLink}
              onClick={() => navigate("/settings#task-defaults")}
            >
              {t("打开设置")}
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          </aside>

          <article className={styles.panel}>
            <header className={styles.panelHeading}>
              <div>
                <span className={styles.panelIcon}>
                  <Bot size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className={styles.eyebrow}>PROVIDERS</p>
                  <h2>{t("已配置 Provider")}</h2>
                </div>
              </div>
              <span className={styles.countBadge}>{providers.size}</span>
            </header>
            {providerEntries.length === 0 ? (
              <p className={styles.panelEmpty}>
                {t(
                  "Pi 没有返回可用模型；请先在 Pi 中完成 Provider 登录或 API Key 配置。"
                )}
              </p>
            ) : (
              <div className={styles.providerList}>
                {providerEntries.map(([provider, modelCount]) => (
                  <div className={styles.providerRow} key={provider}>
                    <div className={styles.providerAvatar}>
                      {provider.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <strong>{provider}</strong>
                      <span>
                        {t("{{count}} 个模型", { count: modelCount })}
                      </span>
                    </div>
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className={styles.panel}>
            <header className={styles.panelHeading}>
              <div>
                <span className={styles.panelIcon}>
                  <Cpu size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className={styles.eyebrow}>MODELS</p>
                  <h2>{t("可用模型")}</h2>
                </div>
              </div>
              <span className={styles.countBadge}>{status.models.length}</span>
            </header>
            {status.models.length === 0 ? (
              <div className={styles.emptyPanel}>
                <EmptyState
                  icon={<Cpu size={24} />}
                  title={t("可用模型")}
                >
                  {t(
                    "Pi 没有返回可用模型；请先在 Pi 中完成 Provider 登录或 API Key 配置。"
                  )}
                </EmptyState>
              </div>
            ) : (
              <div className={styles.modelList}>
                {status.models.map((model) => (
                  <div
                    className={styles.modelRow}
                    key={`${model.provider}/${model.id}`}
                  >
                    <span className={styles.modelDot} aria-hidden="true" />
                    <div>
                      <strong>{model.id}</strong>
                      <code>{model.provider}/{model.id}</code>
                    </div>
                    <span className={styles.providerChip}>
                      {model.provider}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      )}

      {tab === "skills" && (
        <section
          id="pi-skills-panel"
          className={styles.skillsLayout}
          role="tabpanel"
          aria-labelledby="pi-skills-tab"
          tabIndex={0}
        >
          <article className={styles.panel}>
            <header className={styles.panelHeading}>
              <div>
                <span className={styles.panelIcon}>
                  <Sparkles size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className={styles.eyebrow}>PI SKILLS</p>
                  <h2>{t("当前可用 Skills")}</h2>
                </div>
              </div>
              <span className={styles.countBadge}>{status.skills.length}</span>
            </header>
            {status.skills.length === 0 ? (
              <div className={styles.emptyPanel}>
                <EmptyState
                  icon={<Sparkles size={24} />}
                  title={t("没有已加载的 Skill")}
                >
                  {t("Pi 没有从当前全局环境发现可用 Skill。")}
                </EmptyState>
              </div>
            ) : (
              <div className={styles.skillList}>
                {status.skills.map((skill) => (
                  <article className={styles.skillRow} key={skill.name}>
                    <span className={styles.skillIcon} aria-hidden="true">
                      <Sparkles size={16} />
                    </span>
                    <div className={styles.skillCopy}>
                      <div className={styles.skillTitleLine}>
                        <strong>{skill.name}</strong>
                        <span>{skillScopeLabel(skill.scope)}</span>
                      </div>
                      <p>{skill.description || t("此 Skill 未提供说明。")}</p>
                      <code title={skill.path ?? undefined}>
                        {skillSourceLabel(skill.source, skill.path)}
                      </code>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className={styles.managerNote}>
              {t(
                "这里只显示 Pi 在全局环境实际加载的 Skills，包括用户目录和 Packages 提供的能力；项目 Skills 会由对应会话 Worker 按工作目录加载。"
              )}
            </p>
          </article>
        </section>
      )}

      {tab === "packages" && (
        <section
          id="pi-packages-panel"
          className={styles.packagesLayout}
          role="tabpanel"
          aria-labelledby="pi-packages-tab"
          tabIndex={0}
        >
          <article className={ui(styles.panel, styles.installPanel)}>
            <header className={styles.panelHeading}>
              <div>
                <span className={styles.panelIcon}>
                  <Download size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className={styles.eyebrow}>INSTALL PACKAGE</p>
                  <h2>{t("安装 Pi Package")}</h2>
                </div>
              </div>
            </header>
            <div className={styles.packageWarning}>
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                {t(
                  "Pi Package 可以执行代码并影响 Agent 行为，只安装你信任的来源。"
                )}
              </span>
            </div>
            <form
              className={styles.installForm}
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void packageAction("install", source);
              }}
            >
              <label className={ui(styles.field, "field")}>
                <span>{t("Package 来源")}</span>
                <input
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="url"
                  autoComplete="off"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="npm:@scope/package@version"
                />
                <small>
                  {t("支持官方定义的 npm:、git:、URL 或绝对本地路径。")}
                </small>
              </label>
              <Button
                type="submit"
                disabled={!source.trim()}
                loading={busy}
                loadingLabel={t("安装中…")}
              >
                <Download size={16} aria-hidden="true" />
                {t("安装")}
              </Button>
            </form>
          </article>

          <article className={styles.panel}>
            <header className={styles.panelHeading}>
              <div>
                <span className={styles.panelIcon}>
                  <Package size={18} aria-hidden="true" />
                </span>
                <div>
                  <p className={styles.eyebrow}>INSTALLED</p>
                  <h2>{t("已安装 Packages")}</h2>
                </div>
              </div>
              <Button
                variant="secondary"
                loading={busy}
                loadingLabel={t("更新中…")}
                onClick={() => void packageAction("update_all")}
              >
                <RefreshCcw size={15} aria-hidden="true" />
                {t("全部更新")}
              </Button>
            </header>
            {status.packages.length === 0 ? (
              <div className={styles.emptyPanel}>
                <EmptyState
                  icon={<Package size={24} />}
                  title={t("没有已登记的 Package")}
                >
                  {t("Pi 的 list 命令未返回任何 Package。")}
                </EmptyState>
              </div>
            ) : (
              <div className={styles.packageList}>
                {status.packages.map((item) => (
                  <div className={styles.packageRow} key={item}>
                    <div className={styles.packageIcon}>
                      <Box size={17} aria-hidden="true" />
                    </div>
                    <span title={item}>{item}</span>
                    <IconButton
                      label={t("移除 {{name}}", { name: item })}
                      variant="danger"
                      disabled={busy}
                      onClick={() => void packageAction("remove", item)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <p className={styles.managerNote}>
              {t(
                "Package 变更会在存在活动 Worker 时默认被阻止；仅在明确确认风险后才能强制执行。新会话会加载修改后的版本。"
              )}
            </p>
          </article>
        </section>
      )}
    </section>
  );
}

function skillScopeLabel(scope: PiStatus["skills"][number]["scope"]): string {
  if (scope === "user") return t("用户级");
  if (scope === "project") return t("项目级");
  if (scope === "temporary") return t("临时");
  return t("未知来源");
}

function skillSourceLabel(source: string | null, path: string | null): string {
  if (source && source !== "auto") return source;
  return path ?? t("Pi 自动发现");
}
