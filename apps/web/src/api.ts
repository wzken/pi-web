interface ApiErrorShape {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export const unauthorizedEvent = "pi-web:unauthorized";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "API_ERROR",
    public readonly details?: unknown
  ) {
    super(message);
  }
}

const localizedApiErrors: Record<string, string> = {
  UNAUTHORIZED: "请先登录",
  ORIGIN_REJECTED: "请求来源与当前 Pi Web 地址不匹配",
  KEY_REQUIRED: "请输入访问密钥",
  INVALID_ACCESS_KEY: "访问密钥不正确",
  NOT_FOUND: "请求的接口不存在",
  PATH_NOT_FOUND: "文件或目录不存在",
  NOT_A_DIRECTORY: "路径不是目录",
  PATH_NOT_ACCESSIBLE: "目录不可访问",
  PATH_OUTSIDE_ROOTS: "路径不在允许的根目录内",
  INVALID_PATH: "路径包含无效字符",
  PATH_ESCAPE: "路径逃出了当前会话目录",
  NOT_A_FILE: "路径不是文件",
  FILE_TOO_LARGE: "文件过大，无法进行文本预览",
  NOT_TEXT: "文件不是可安全预览的文本",
  ENTRY_ALREADY_EXISTS: "同名文件或目录已经存在",
  WORKSPACE_ROOT_MUTATION_FORBIDDEN: "不能修改工作区根目录",
  SESSION_NOT_FOUND: "会话不存在",
  SESSION_DELETED: "该请求对应的会话已被删除",
  SESSION_BUSY: "请先关闭正在运行的会话，再将其删除",
  JOB_NOT_FOUND: "调度不存在",
  RUN_NOT_FOUND: "调度运行记录不存在",
  SESSIOND_UNAVAILABLE: "Session Daemon 暂不可用",
  SESSIOND_DISCONNECTED: "Session Daemon 暂不可用",
  SESSIOND_TIMEOUT: "Session Daemon 请求超时",
  WORKER_LIMIT: "活动 Worker 数量已达到上限",
  SESSION_NOT_ACTIVE: "会话当前未运行",
  INVALID_MODEL: "模型格式必须为 provider/model-id",
  JOB_LIMIT: "调度数量已达到上限",
  THEME_NOT_FOUND: "主题不存在或尚未安装",
  THEME_ARCHIVE_TOO_LARGE: "主题包过大",
  THEME_ARCHIVE_INVALID: "主题包格式不受支持",
  THEME_CSS_UNSAFE: "主题 CSS 包含不安全内容",
  BACKGROUND_URL_INVALID: "背景图片 URL 无效",
  TERMINAL_LIMIT: "终端数量已达到上限",
  PI_RPC_TIMEOUT: "Pi RPC 请求超时"
};

export function localizedErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const source = localizedApiErrors[error.code];
    if (source) return t(source);
  }
  return error instanceof Error ? error.message : String(error);
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const contentType = response.headers.get("content-type") ?? "";
  const value = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : await response.text();
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event(unauthorizedEvent));
    }
    const shaped = value as ApiErrorShape;
    throw new ApiError(
      shaped?.error?.message || `Request failed (${response.status})`,
      response.status,
      shaped?.error?.code,
      shaped?.error?.details
    );
  }
  return value as T;
}

export function isAbortError(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "AbortError") ||
    (reason instanceof Error && reason.name === "AbortError")
  );
}

export function jsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" }
  };
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale(), { notation: "compact" }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return t("未知");
  return new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4
  }).format(value);
}
import { getLocale, t } from "./i18n";
