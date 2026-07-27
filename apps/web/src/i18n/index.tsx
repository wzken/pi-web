import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

export type LanguagePreference = "system" | "zh-CN" | "en-US";
export type AppLocale = Exclude<LanguagePreference, "system">;

const languageStorageKey = "pi-web.language";
const defaultLocale: AppLocale = "zh-CN";
let activeLocale: AppLocale = defaultLocale;

const englishMessages: Record<string, string> = {
  "处理中…": "Working…",
  "正在加载": "Loading",
  "启动中": "Starting",
  "运行中": "Running",
  "等待指令": "Waiting",
  "停止中": "Stopping",
  "停止中…": "Stopping…",
  "失败": "Failed",
  "已中断": "Interrupted",
  "已关闭": "Closed",
  "已计划": "Scheduled",
  "成功": "Succeeded",
  "超时": "Timed out",
  "跳过重叠": "Overlap skipped",
  "已取消": "Cancelled",
  "已错过": "Missed",
  "未知": "Unknown",
  "关闭通知": "Dismiss notification",
  "关闭错误提示": "Dismiss error",
  "新会话": "New session",
  "总览": "Overview",
  "会话": "Sessions",
  "调度": "Schedules",
  "Pi 管理": "Pi management",
  "设置": "Settings",
  "重新连接": "Reconnect",
  "连接 Pi Web": "Connecting to Pi Web",
  "载入页面": "Loading page",
  "关闭导航": "Close navigation",
  "主导航": "Main navigation",
  "打开命令面板": "Open command palette",
  "命令": "Commands",
  "独立运行中": "Running independently",
  "退出登录": "Sign out",
  "打开导航": "Open navigation",
  "登录失败": "Login failed",
  "让 Pi 留在工作现场。": "Keep Pi at the workbench.",
  "从电脑、手机或平板接管长期运行的 Coding Agent。浏览器关闭，任务仍然继续。":
    "Supervise a long-running coding agent from your computer, phone, or tablet. Work continues after the browser closes.",
  "本机运行时已就绪": "Local runtime ready",
  "单用户 · 私有部署 · 持久会话":
    "Single user · Private deployment · Persistent sessions",
  "进入你的 Pi Web": "Sign in to Pi Web",
  "输入首次安装时显示的访问密钥。密钥不会保存在浏览器本地存储中。":
    "Enter the access key shown during installation. It is not stored in browser local storage.",
  "当前连接未加密。不要通过不可信公网传输访问密钥或控制 Pi。":
    "This connection is not encrypted. Do not send the access key or control Pi over an untrusted network.",
  "访问密钥": "Access key",
  "粘贴访问密钥": "Paste access key",
  "正在验证…": "Verifying…",
  "安全登录": "Sign in securely",
  "密钥遗失？在服务器运行 {{command}}。":
    "Lost the key? Run {{command}} on the server.",
  "读取运行状态": "Loading runtime status",
  "正在运行": "Running",
  "活跃 Pi 会话": "Active Pi sessions",
  "今日会话": "Sessions today",
  "新创建": "Created today",
  "今日 Token": "Tokens today",
  "{{input}} 输入 · {{output}} 输出": "{{input}} input · {{output}} output",
  "已知成本": "Known cost",
  "Provider 报告值": "Provider-reported value",
  "运行总览": "Runtime overview",
  "掌握 Pi 会话、定时任务和今日用量。":
    "Monitor Pi sessions, schedules, and today's usage.",
  "新建会话": "New session",
  "今日指标": "Today's metrics",
  "最近会话": "Recent sessions",
  "查看全部": "View all",
  "还没有会话。创建一个，让 Pi 开始工作。":
    "No sessions yet. Create one and let Pi get to work.",
  "最近运行": "Recent runs",
  "管理调度": "Manage schedules",
  "暂无 Cron 运行记录。": "No Cron runs yet.",
  "Cron 触发": "Cron trigger",
  "立即运行": "Run now",
  "最近有 {{count}} 个会话需要留意":
    "{{count}} recent session(s) need attention",
  "查看详情": "View details",
  "读取会话": "Loading sessions",
  "这里用于查找和恢复历史；新会话从首页发送第一条任务后创建。":
    "Find and resume history here. New sessions are created after the first task is sent from Home.",
  "发起新会话": "Start a new session",
  "搜索名称或工作目录": "Search name or working directory",
  "{{count}} 个会话": "{{count}} session(s)",
  "没有匹配的会话": "No matching sessions",
  "开始第一个会话": "Start your first session",
  "输入第一条任务": "Enter the first task",
  "换一个关键词试试。": "Try a different search term.",
  "选择工作目录并发送任务，Pi 会自动创建会话并在后台持续运行。":
    "Choose a working directory and send a task. Pi will create a session and keep it running in the background.",
  "未读": "Unread",
  "工具调用": "Tool calls",
  "默认": "Default",
  "模型": "Model",
  "交互": "Interactive",
  "设置已保存": "Settings saved",
  "重置访问密钥会立即注销所有浏览器会话。继续吗？":
    "Resetting the access key will immediately sign out every browser session. Continue?",
  "当前浏览器不支持系统通知":
    "This browser does not support system notifications",
  "浏览器未授予通知权限": "Browser notification permission was not granted",
  "读取设置": "Loading settings",
  "限制文件边界、调度策略和 Pi 运行参数。":
    "Control file boundaries, scheduling policy, and Pi runtime settings.",
  "保存中…": "Saving…",
  "保存设置": "Save settings",
  "界面语言": "Interface language",
  "语言只保存在当前浏览器，可跟随操作系统设置。":
    "The language is stored only in this browser and can follow the operating system.",
  "语言": "Language",
  "跟随系统": "Follow system",
  "简体中文": "Simplified Chinese",
  "英语": "English",
  "完成提醒": "Completion alerts",
  "仅在 Pi Web 位于后台时提醒；内容只显示会话名称。":
    "Alert only while Pi Web is in the background; notifications show only the session name.",
  "浏览器通知": "Browser notifications",
  "会话完成或异常退出时发送系统通知。首次开启会请求浏览器权限。":
    "Send a system notification when a session finishes or exits unexpectedly. Permission is requested on first use.",
  "完成提示音": "Completion sound",
  "使用浏览器本地生成的短提示音，不加载外部音频。":
    "Play a short sound generated locally by the browser without external audio.",
  "目录访问": "Directory access",
  "Pi Web 的目录选择器和文件 API 只能进入这些真实路径。":
    "The directory picker and file API can access only these real paths.",
  "允许根目录（每行一个）": "Allowed roots (one per line)",
  "允许访问任意目录": "Allow access to any directory",
  "危险：这会关闭 Pi Web 的路径根限制，但不会限制 Pi 自身。":
    "Danger: this disables Pi Web's root restriction, but does not restrict Pi itself.",
  "Pi 默认值": "Pi defaults",
  "新建会话可以覆盖这些值。": "New sessions can override these values.",
  "Pi 可执行文件": "Pi executable",
  "默认思考级别": "Default thinking level",
  "Pi 默认": "Pi default",
  "默认附加系统提示词": "Default appended system prompt",
  "例如：所有回答使用中文；修改代码后必须运行测试。":
    "Example: Run tests after changing code.",
  "新会话启动时通过 Pi 的 --append-system-prompt 注入。它会保留 Pi 自带的编码代理系统提示词；已经运行的会话不会被热修改。":
    "Injected through Pi's --append-system-prompt when a new session starts. Pi's coding-agent system prompt is preserved, and running sessions are not changed.",
  "Cron 与安全": "Cron and security",
  "模型仍要经过服务端完整校验。":
    "Model-created schedules still pass full server-side validation.",
  "默认时区": "Default time zone",
  "默认超时（秒）": "Default timeout (seconds)",
  "最低间隔（分钟）": "Minimum interval (minutes)",
  "模型创建 Cron 策略": "Model-created Cron policy",
  "允许创建并启用": "Allow and enable",
  "仅创建，默认停用": "Create disabled",
  "拒绝模型调度": "Deny model scheduling",
  "自动（HTTPS 时启用）": "Automatic (enabled on HTTPS)",
  "始终启用": "Always",
  "不启用": "Never",
  "重置后所有现有浏览器会话会立即失效，新密钥只显示一次。":
    "Resetting immediately invalidates all browser sessions. The new key is shown once.",
  "重置中…": "Resetting…",
  "重置密钥": "Reset key",
  "系统诊断": "System diagnostics",
  "检查数据库、Session Daemon、Scheduler 和 Pi 命令。":
    "Check the database, session daemon, scheduler, and Pi command.",
  "诊断中…": "Diagnosing…",
  "运行 Doctor": "Run doctor",
  "Pi RPC 握手": "Pi RPC handshake",
  "Package 命令": "Package commands",
  "{{count}} 个活动 Worker": "{{count}} active worker(s)",
  "数据保留": "Data retention",
  "v0.1 不自动删除 Pi 会话文件、调度历史或关联会话。请由服务器管理员按备份策略管理磁盘。":
    "v0.1 does not automatically delete Pi session files, schedule history, or linked sessions. The server operator must manage storage according to the backup policy.",
  "当前连接未加密": "Connection is not encrypted",
  "不要通过不可信公网传输访问密钥或控制 Pi。":
    "Do not send the access key or control Pi over an untrusted network.",
  "Pi Web 不提供沙箱": "Pi Web does not provide a sandbox",
  "Pi Worker 拥有运行 Pi Web 的系统用户权限。":
    "Pi workers have the permissions of the operating-system user running Pi Web.",
  "保存新的访问密钥": "Save the new access key",
  "关闭此窗口后无法再次查看。所有浏览器现已注销。":
    "It cannot be viewed again after this dialog closes. All browsers are now signed out.",
  "密钥已复制": "Key copied",
  "复制密钥": "Copy key",
  "浏览代码库并说明它的核心结构":
    "Explore the repository and explain its core structure",
  "检查最近的改动，找出可能的回归":
    "Review the latest changes and find possible regressions",
  "运行测试并修复第一个失败项":
    "Run the tests and fix the first failure",
  "帮我规划下一步实现": "Help me plan the next implementation step",
  "附件任务": "Attachment task",
  "准备工作区": "Preparing workspace",
  "收起会话栏": "Collapse session rail",
  "展开会话栏": "Expand session rail",
  "选择工作目录": "Choose working directory",
  "全部会话": "All sessions",
  "工作区": "Workspace",
  "要在 {{workspace}} 中做什么？": "What should Pi do in {{workspace}}?",
  "输入任务即创建会话；目录、模型和系统提示词会随会话保存。":
    "Sending a task creates a session; its directory, model, and system prompt are saved with it.",
  "描述任务，使用 @ 引用工作区文件，或添加附件…":
    "Describe a task, reference workspace files with @, or add attachments…",
  "新会话任务": "New session task",
  "思考级别": "Thinking level",
  "创建中…": "Creating…",
  "创建会话并发送": "Create session and send",
  "系统提示词": "System prompt",
  "附加系统提示词": "Appended system prompt",
  "可选：追加到 Pi 自带系统提示词，不会替换编码代理能力":
    "Optional: append to Pi's system prompt without replacing coding-agent capabilities",
  "仅对这个新会话生效；清空表示不追加。":
    "Applies only to this new session; leave empty to append nothing.",
  "任务建议": "Task suggestions",
  "尚未选择目录": "No directory selected",
  "请从输入框下方选择允许的工作目录。":
    "Choose an allowed working directory below the task input.",
  "思考": "Thinking",
  "已追加": "Appended",
  "使用全局设置": "Use global setting",
  "附件会保存到哪里？": "Where are attachments saved?",
  "普通文件上传到当前目录的 `.pi-web/attachments`，并作为相对路径交给 Pi；图片保持内联发送。":
    "Regular files are uploaded to `.pi-web/attachments` in the current directory and passed to Pi as relative paths; images remain inline.",
  "Pi 会话": "Pi session",
  "先在设置中配置允许目录": "Configure allowed directories in Settings first",
  "浏览工作目录": "Browse working directory",
  "选择目录": "Choose directory",
  "关闭目录选择": "Close directory picker",
  "允许的根目录": "Allowed roots",
  "当前目录": "Current directory",
  "返回上级": "Go to parent directory",
  "这个目录没有子文件夹，可以直接选择它。":
    "This directory has no subfolders and can be selected directly.",
  "正在读取目录…": "Loading directory…",
  "添加到常用目录": "Add to favorite directories",
  "取消": "Cancel",
  "选择中…": "Selecting…",
  "选择此目录": "Select this directory",
  "添加附件": "Add attachment",
  "添加图片、代码、文档或日志": "Add images, code, documents, or logs",
  "待上传文件": "Files waiting to upload",
  "移除附件 {{name}}": "Remove attachment {{name}}",
  "每条消息最多添加 {{count}} 个普通文件。":
    "Each message can include up to {{count}} regular files.",
  "{{name}} 超过 {{size}}。": "{{name}} exceeds {{size}}.",
  "普通附件总大小不能超过 {{size}}。":
    "Regular attachments cannot exceed {{size}} in total.",
  "请选择 PNG、JPEG、GIF 或 WebP 图片。":
    "Choose PNG, JPEG, GIF, or WebP images.",
  "每条消息最多添加 {{count}} 张图片。":
    "Each message can include up to {{count}} images.",
  "图片总大小不能超过 {{size}}。": "Images cannot exceed {{size}} in total.",
  "{{name}}的格式不受支持。": "{{name}} uses an unsupported format.",
  "{{name}}超过 4.5 MB。": "{{name}} exceeds 4.5 MB.",
  "图片": "image",
  "粘贴的图片": "Pasted image",
  "添加图片": "Add image",
  "添加图片（最多 {{count}} 张）": "Add images (up to {{count}})",
  "待发送图片": "Images waiting to send",
  "移除图片 {{name}}": "Remove image {{name}}",
  "无法读取图片 {{name}}": "Could not read image {{name}}",
  "Pi 默认模型": "Pi default model",
  "Pi 会话需要处理": "Pi session needs attention",
  "Pi 会话已完成": "Pi session completed",
  "选择工作目录并开始任务": "Choose a working directory and start a task",
  "打开总览": "Open overview",
  "查看运行状态和用量": "View runtime status and usage",
  "浏览全部会话": "Browse all sessions",
  "查找和恢复历史会话": "Find and resume session history",
  "打开调度": "Open schedules",
  "管理计划任务": "Manage scheduled tasks",
  "打开 Pi 管理": "Open Pi management",
  "管理模型和运行时": "Manage models and runtime",
  "打开设置": "Open settings",
  "调整界面与系统选项": "Adjust interface and system options",
  "命令面板": "Command palette",
  "搜索页面或最近会话…": "Search pages or recent sessions…",
  "没有匹配的页面或最近会话": "No matching pages or recent sessions",
  "读取最近会话": "Loading recent sessions",
  "选择": "Select",
  "打开": "Open",
  "外观已应用": "Appearance applied",
  "已安装 {{name}}": "Installed {{name}}",
  "主题包已更新": "Theme package updated",
  "背景图片已上传，点击“应用外观”生效":
    "Background uploaded. Select Apply appearance to save it.",
  "删除主题包“{{name}}”？主题文件将从服务器移除。":
    "Delete theme package “{{name}}”? Its files will be removed from the server.",
  "主题包已删除": "Theme package deleted",
  "已移除上传的背景": "Uploaded background removed",
  "读取主题": "Loading themes",
  "外观与主题包": "Appearance and theme packages",
  "主题可覆盖设计 token、组件 CSS、字体和背景；内置 Agegr Light / Dark。":
    "Themes can override design tokens, component CSS, fonts, and backgrounds; Agegr Light and Dark are built in.",
  "声明式包，不执行脚本": "Declarative packages; scripts are not executed",
  "安全主题模式已开启": "Safe theme mode is active",
  "当前强制使用内置主题，并忽略主题 CSS 与背景。":
    "The built-in theme is forced and uploaded theme CSS and backgrounds are ignored.",
  "退出安全模式": "Exit safe mode",
  "配色模式": "Color mode",
  "双模式主题会在同一主题内切换；单模式主题不匹配时使用对应的内置 Agegr 配色。":
    "Dual-mode themes switch within one theme. A mismatched single-mode theme falls back to the corresponding built-in Agegr scheme.",
  "自动": "Automatic",
  "当前{{scheme}}": "Currently {{scheme}}",
  "浅色": "Light",
  "深色": "Dark",
  "始终浅色": "Always light",
  "始终深色": "Always dark",
  "主题": "Theme",
  "内置主题不可删除；上传同 ID 的 ZIP 可更新已安装主题。":
    "Built-in themes cannot be deleted. Upload a ZIP with the same ID to update an installed theme.",
  "安装中…": "Installing…",
  "上传 ZIP 主题包": "Upload theme ZIP",
  "删除中…": "Deleting…",
  "删除": "Delete",
  "选择主题": "Choose theme",
  "工作区背景": "Workspace background",
  "背景位于界面底层；主题仍负责面板透明度和文字对比度。":
    "The background sits behind the interface; the theme still controls panel opacity and text contrast.",
  "背景来源": "Background source",
  "无背景图片": "No background image",
  "主题包自带背景": "Theme-provided background",
  "上传到本机": "Upload to this server",
  "图片 URL": "Image URL",
  "上传中…": "Uploading…",
  "更换图片": "Replace image",
  "上传图片": "Upload image",
  "移除图片": "Remove image",
  "PNG / JPEG / WebP / GIF / AVIF，最大 8 MB":
    "PNG / JPEG / WebP / GIF / AVIF, up to 8 MB",
  "填充方式": "Fit",
  "覆盖": "Cover",
  "完整显示": "Contain",
  "平铺": "Tile",
  "位置": "Position",
  "居中": "Center",
  "顶部": "Top",
  "底部": "Bottom",
  "左侧": "Left",
  "右侧": "Right",
  "遮罩 {{value}}%": "Overlay {{value}}%",
  "模糊 {{value}}px": "Blur {{value}}px",
  "背景预览": "Background preview",
  "未设置背景": "No background",
  "未选择主题": "No theme selected",
  "上传主题": "Uploaded theme",
  "内置主题": "Built-in theme",
  "恢复默认": "Restore defaults",
  "应用中…": "Applying…",
  "应用外观": "Apply appearance",
  "内置": "Built in",
  "已上传": "Uploaded",
  "亮色与暗色": "Light and dark",
  "暗色": "Dark",
  "亮色": "Light",
  "Pi Agent Web 首页": "Pi Agent Web home",
  "新建": "New",
  "选择工作目录后开始": "Choose a working directory to begin",
  "会话创建后显示工作区文件":
    "Workspace files appear after a session is created",
  "会话名称已更新": "Session name updated",
  "对话文件夹已创建": "Conversation folder created",
  "删除对话文件夹“{{name}}”？其中的会话会移回未分类。":
    "Delete conversation folder “{{name}}”? Its sessions will move to Uncategorized.",
  "对话文件夹已删除": "Conversation folder deleted",
  "对话文件夹已重命名": "Conversation folder renamed",
  "创建对话文件夹": "Create conversation folder",
  "对话文件夹名称": "Conversation folder name",
  "文件夹名称": "Folder name",
  "保存文件夹": "Save folder",
  "取消创建": "Cancel creation",
  "文件夹操作 {{name}}": "Folder actions: {{name}}",
  "重命名": "Rename",
  "删除文件夹": "Delete folder",
  "未分类": "Uncategorized",
  "第一条任务会自动建立并启动 Pi 会话。":
    "The first task automatically creates and starts a Pi session.",
  "查看全部会话": "View all sessions",
  "重命名会话": "Rename session",
  "关闭重命名对话框": "Close rename dialog",
  "会话名称": "Session name",
  "保存名称": "Save name",
  "重命名对话文件夹": "Rename conversation folder",
  "关闭重命名文件夹": "Close folder rename dialog",
  "，有未读完成通知": ", has an unread completion alert",
  "会话操作 {{name}}": "Session actions: {{name}}",
  "移动到": "Move to",
  "Package 已安装；新会话会加载它":
    "Package installed; new sessions will load it",
  "Package 已移除": "Package removed",
  "Pi Packages 已更新": "Pi Packages updated",
  "询问 Pi 当前能力": "Loading Pi capabilities",
  "展示 Pi 自己发现的模型、Packages、Skills、Extensions 和模板。":
    "Shows models, Packages, Skills, Extensions, and templates discovered by Pi.",
  "刷新中…": "Refreshing…",
  "刷新状态": "Refresh status",
  "版本未知": "Version unknown",
  "未找到 Pi": "Pi not found",
  "可用": "Available",
  "不可用": "Unavailable",
  "部分 Pi 状态无法读取": "Some Pi status could not be read",
  "Pi 管理类别": "Pi management categories",
  "模型与 Provider": "Models and providers",
  "能力资源": "Capability resources",
  "已配置 Provider": "Configured providers",
  "Pi 没有返回可用模型；请先在 Pi 中完成 Provider 登录或 API Key 配置。":
    "Pi returned no available models. Complete provider login or API key setup in Pi first.",
  "{{count}} 个模型": "{{count}} model(s)",
  "可用模型": "Available models",
  "安装 Pi Package": "Install a Pi Package",
  "Pi Package 可以执行代码并影响 Agent 行为，只安装你信任的来源。":
    "Pi Packages can execute code and affect agent behavior. Install only trusted sources.",
  "Package 来源": "Package source",
  "安装": "Install",
  "支持官方定义的 npm:、git:、URL 或绝对本地路径。":
    "Supports official npm:, git:, URL, or absolute local-path sources.",
  "已安装 Packages": "Installed Packages",
  "更新中…": "Updating…",
  "全部更新": "Update all",
  "没有已登记的 Package": "No registered Packages",
  "Pi 的 list 命令未返回任何 Package。":
    "Pi's list command did not return any Packages.",
  "移除 {{name}}": "Remove {{name}}",
  "当前 Pi 只公开批量更新 Packages；运行中的 Worker 可能需要新建或重启会话才会加载变化。":
    "Pi currently exposes only bulk Package updates. Running workers may need a new or restarted session to load changes.",
  "未发现资源。": "No resources found.",
  "调度已停用": "Schedule disabled",
  "调度已启用": "Schedule enabled",
  "已有运行，本次已按策略跳过":
    "A run is already active; this occurrence was skipped by policy",
  "已创建立即运行": "Run-now session created",
  "删除“{{name}}”？历史运行和对应会话会保留。":
    "Delete “{{name}}”? Run history and linked sessions will be preserved.",
  "调度已删除": "Schedule deleted",
  "读取 Cron 调度": "Loading Cron schedules",
  "每次触发都会创建独立 Pi 会话；错过的运行不会在重启后补跑。":
    "Every trigger creates a separate Pi session. Missed runs are not replayed after restart.",
  "新建调度": "New schedule",
  "还没有定时任务": "No scheduled tasks",
  "创建第一个调度": "Create the first schedule",
  "使用标准五段 Cron 和 IANA 时区，让 Pi 在指定目录按时工作。":
    "Use standard five-field Cron and an IANA time zone to run Pi in a chosen directory.",
  "已启用": "Enabled",
  "已停用": "Disabled",
  "停用调度 {{name}}": "Disable schedule {{name}}",
  "启用调度 {{name}}": "Enable schedule {{name}}",
  "下次：{{date}}": "Next: {{date}}",
  "默认模型": "Default model",
  "{{count}} 分钟超时": "{{count}} minute timeout",
  "上次运行 {{date}}": "Last run {{date}}",
  "来源：{{source}}": "Source: {{source}}",
  "历史": "History",
  "更多调度操作 {{name}}": "More schedule actions: {{name}}",
  "编辑": "Edit",
  "调度已更新": "Schedule updated",
  "调度已创建": "Schedule created",
  "编辑调度": "Edit schedule",
  "关闭调度编辑": "Close schedule editor",
  "名称": "Name",
  "Cron 表达式": "Cron expression",
  "IANA 时区": "IANA time zone",
  "Pi 指令": "Pi instruction",
  "使用默认值": "Use default",
  "超时（秒）": "Timeout (seconds)",
  "创建后立即启用": "Enable immediately after creation",
  "重叠运行默认跳过，不会自动重试。":
    "Overlapping runs are skipped by default and are not retried automatically.",
  "保存调度": "Save schedule",
  "关闭运行历史": "Close run history",
  "暂无运行记录": "No run history",
  "立即运行一次，或等待下一次 Cron 触发。":
    "Run it now or wait for the next Cron trigger.",
  "打开会话": "Open session",
  "每天 {{time}} · {{timezone}}": "Every day at {{time}} · {{timezone}}",
  "每 {{count}} 分钟 · {{timezone}}":
    "Every {{count}} minutes · {{timezone}}",
  "已发送为立即引导，Pi 会在下一个可中断点调整方向。":
    "Sent as steer; Pi will adjust direction at the next interruptible point.",
  "消息已排队，将在当前任务完成后发送。":
    "Message queued and will be sent after the current task finishes.",
  "已请求停止当前任务；会话历史和草稿仍会保留。":
    "Stop requested; session history and the draft are preserved.",
  "完成后排队": "Queue after completion",
  "立即引导": "Steer now",
  "发送下一条指令": "Send the next instruction",
  "Pi 正在启动": "Pi is starting",
  "正在停止当前任务": "Stopping the current task",
  "恢复会话后才能发送": "Resume the session before sending",
  "等待实时连接": "Waiting for the realtime connection",
  "调整 Pi 当前方向…": "Adjust Pi's current direction…",
  "安排当前任务完成后的下一步…":
    "Queue the next step after the current task…",
  "给 Pi 一条新指令…": "Give Pi a new instruction…",
  "实时连接恢复后可发送，草稿会保留…":
    "Send after the realtime connection returns; the draft is preserved…",
  "停止当前任务": "Stop current task",
  "发送中…": "Sending…",
  "排队发送": "Queue message",
  "发送": "Send",
  "立即引导当前任务": "Steer the current task now",
  "当前任务完成后发送": "Send after the current task",
  "默认思考": "Default thinking",
  "Enter 发送 · Shift+Enter 换行":
    "Enter to send · Shift+Enter for a new line",
  "收起": "Collapse",
  "展开": "Expand",
  "{{action}}会话栏（Ctrl+B）": "{{action}} session rail (Ctrl+B)",
  "导出": "Export",
  "系统": "System",
  "分支": "Branches",
  "终端": "Terminal",
  "当前 Pi 未报告上下文占用": "Pi has not reported context usage",
  "开始于 {{date}}": "Started at {{date}}",
  "成本状态：{{status}}": "Cost status: {{status}}",
  "恢复中…": "Resuming…",
  "恢复": "Resume",
  "关闭会话": "Close session",
  "关闭中…": "Closing…",
  "关闭会释放当前 Pi Worker。历史仍会保留，之后可以恢复。继续吗？":
    "Closing releases the current Pi worker. History is preserved and can be resumed later. Continue?",
  "关闭": "Close",
  "更多会话操作": "More session actions",
  "正在重新发送…": "Resending…",
  "重新发送最后一条": "Resend last instruction",
  "关闭文件面板": "Close file panel",
  "打开文件面板": "Open file panel",
  "实时连接已断开，正在重新连接。草稿已保留。":
    "The realtime connection was lost and is reconnecting. The draft is preserved.",
  "正在建立实时连接…": "Establishing realtime connection…",
  "载入终端": "Loading terminal",
  "点击背景缩回终端": "Tap the backdrop to collapse the terminal",
  "打开文件": "Open files",
  "终端已停止": "Terminal stopped",
  "进程已退出，代码 {{code}}": "Process exited with code {{code}}",
  "终端连接尚未就绪": "Terminal connection is not ready",
  "终端中没有可复制的输出": "There is no terminal output to copy",
  "已复制选中内容": "Selected content copied",
  "已复制终端输出": "Terminal output copied",
  "复制终端输出失败": "Could not copy terminal output",
  "会话终端": "Session terminal",
  "展开终端": "Expand terminal",
  "复制终端输出": "Copy terminal output",
  "清空终端显示": "Clear terminal display",
  "停止": "Stop",
  "缩回终端": "Collapse terminal",
  "关闭终端面板": "Close terminal panel",
  "系统默认 Shell": "System default shell",
  "终端已结束": "Terminal ended",
  "正在启动终端": "Starting terminal",
  "启动中…": "Starting…",
  "运行中…": "Running…",
  "启动工作区终端": "Start workspace terminal",
  "Shell 将以 Pi Web 系统用户权限运行，工作目录固定为当前会话目录。":
    "The shell runs with the Pi Web system user's permissions in the current session directory.",
  "重新启动": "Restart",
  "启动终端": "Start terminal",
  "终端快捷键": "Terminal shortcut keys",
  "键盘": "Keyboard",
  "未启动": "Not started",
  "连接中": "Connecting",
  "已连接": "Connected",
  "重连中": "Reconnecting",
  "已退出": "Exited",
  "异常": "Error",
  "已重命名为 {{name}}": "Renamed to {{name}}",
  "已创建{{type}} {{name}}": "Created {{type}} {{name}}",
  "文件夹": "folder",
  "文件": "file",
  "相对路径已复制": "Relative path copied",
  "新建文件或文件夹": "Create file or folder",
  "新建文件": "New file",
  "新建文件夹": "New folder",
  "关闭文件": "Close files",
  "读取目录": "Loading directory",
  "文件操作 {{name}}": "File actions: {{name}}",
  "复制相对路径": "Copy relative path",
  "目录过大，仅显示前 2000 项":
    "Directory is large; showing only the first 2,000 entries",
  "重命名{{type}}": "Rename {{type}}",
  "新建{{type}}": "New {{type}}",
  "新名称": "New name",
  "{{type}}名称": "{{type}} name",
  "例如 docs": "For example: docs",
  "例如 notes.md": "For example: notes.md",
  "操作范围仅限当前会话的工作目录，且不会覆盖同名项目。":
    "The operation is limited to this session's working directory and will not overwrite an existing item.",
  "确认重命名": "Confirm rename",
  "创建": "Create",
  "新窗口打开": "Open in new window",
  "关闭预览": "Close preview",
  "浏览器无法安全预览此格式。":
    "The browser cannot safely preview this format.",
  "下载文件": "Download file",
  "载入中…": "Loading…",
  "加载更早消息": "Load earlier messages",
  "Pi 正在回复": "Pi is responding",
  "会话已就绪": "Session ready",
  "在下方输入任务，Pi 会在这个工作目录中开始行动。":
    "Enter a task below and Pi will start working in this directory.",
  "回到底部": "Jump to bottom",
  "你": "You",
  "思考过程": "Thinking process",
  "Pi 会话图片": "Pi session image",
  "正在执行": "Running",
  "应用模型": "Apply model",
  "先恢复会话，才能修改运行参数。":
    "Resume the session before changing runtime settings.",
  "工作目录": "Working directory",
  "会话 ID": "Session ID",
  "实际生效的系统提示词": "Effective system prompt",
  "Pi 未返回系统提示词": "Pi did not return a system prompt",
  "当前 Pi 版本或已关闭的会话没有返回该值。配置的附加内容：":
    "The current Pi version or a closed session did not return this value. Configured appended content: ",
  "无": "None",
  "会话分支概览": "Session branch overview",
  "会话分支": "Session branches",
  "{{count}} 个分叉点": "{{count}} branch point(s)",
  "当前为单一路径": "Currently a single path",
  "当前": "Current",
  "会话树较大，仅展示最近节点和当前路径。":
    "The session tree is large; only recent nodes and the current path are shown.",
  "只读概览；当前 Pi RPC 不支持网页内切换分支。":
    "Read-only overview; the current Pi RPC does not support switching branches in the web UI.",
  "摘要": "Summary",
  "压缩": "Compaction",
  "已排队消息": "Queued messages",
  "已排队": "Queued",
  "完成后": "After completion",
  "上一条指令未得到回复": "The previous instruction received no response",
  "恢复 Pi Worker，并重新发送最后一条用户指令。":
    "Resume the Pi worker and resend the last user instruction.",
  "重试中…": "Retrying…",
  "恢复并重试": "Resume and retry",
  "已请求中止当前轮次": "Abort requested for the current turn",
  "正在恢复 Pi Worker": "Resuming the Pi worker",
  "会话 Worker 已关闭": "Session worker closed",
  "，并重新发送 {{count}} 张图片": ", including {{count}} image(s)",
  "这会再次执行最后一条用户指令{{imageNote}}，可能重复修改文件或运行命令。继续吗？":
    "This will run the last user instruction again{{imageNote}} and may repeat file changes or commands. Continue?",
  "最后一条指令已重新发送": "Last instruction resent",
  "会话快照已导出": "Session snapshot exported",
  "恢复会话快照": "Restoring session snapshot",
  "请先登录": "Sign in required",
  "请求来源与当前 Pi Web 地址不匹配":
    "Request origin does not match this Pi Web host",
  "请输入访问密钥": "Access key is required",
  "访问密钥不正确": "Access key is incorrect",
  "请求的接口不存在": "API route not found",
  "目录不存在": "Directory does not exist",
  "路径不是目录": "Path is not a directory",
  "目录不可访问": "Directory is not accessible",
  "路径不在允许的根目录内": "Path is outside allowed roots",
  "路径包含无效字符": "Path contains invalid characters",
  "文件或目录不存在": "File or directory does not exist",
  "路径逃出了当前会话目录": "Path escapes the session directory",
  "路径不是文件": "Path is not a file",
  "文件过大，无法进行文本预览": "File is too large for text preview",
  "文件不是可安全预览的文本": "File is not recognized as safe text",
  "同名文件或目录已经存在": "A file or directory with this name already exists",
  "不能修改工作区根目录": "The workspace root cannot be modified",
  "会话不存在": "Session not found",
  "调度不存在": "Schedule not found",
  "调度运行记录不存在": "Schedule run not found",
  "Session Daemon 暂不可用": "Session daemon is unavailable",
  "Session Daemon 请求超时": "Session daemon request timed out",
  "活动 Worker 数量已达到上限": "Concurrent worker limit reached",
  "会话当前未运行": "Session is not active",
  "模型格式必须为 provider/model-id":
    "Model must use provider/model-id format",
  "调度数量已达到上限": "Schedule limit reached",
  "主题不存在或尚未安装": "Theme is not installed",
  "主题包过大": "Theme package is too large",
  "主题包格式不受支持": "Theme package format is not supported",
  "主题 CSS 包含不安全内容": "Theme CSS contains unsafe content",
  "背景图片 URL 无效": "Background image URL is invalid",
  "终端数量已达到上限": "Terminal limit reached",
  "Pi RPC 请求超时": "Pi RPC request timed out"
};

interface LanguageContextValue {
  preference: LanguagePreference;
  locale: AppLocale;
  setPreference: (preference: LanguagePreference) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const languageDetector = new LanguageDetector(undefined, {
  order: ["navigator"],
  caches: []
});

function browserLocale(): AppLocale {
  const detected = languageDetector.detect(["navigator"]);
  const languages =
    typeof detected === "string"
      ? [detected]
      : (detected ?? (typeof navigator === "undefined" ? [] : navigator.languages));
  if (languages.length === 0) return defaultLocale;
  return languages.some((language) =>
    language.toLowerCase().startsWith("zh")
  )
    ? "zh-CN"
    : "en-US";
}

function loadPreference(): LanguagePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(languageStorageKey);
  return stored === "zh-CN" || stored === "en-US" || stored === "system"
    ? stored
    : "system";
}

function resolveLocale(preference: LanguagePreference): AppLocale {
  return preference === "system" ? browserLocale() : preference;
}

activeLocale = resolveLocale(loadPreference());

void i18next
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": { translation: {} },
      "en-US": { translation: englishMessages }
    },
    lng: activeLocale,
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    load: "currentOnly",
    keySeparator: false,
    nsSeparator: false,
    initAsync: false,
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    },
    returnNull: false
  });

export { i18next };

export function LanguageProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] =
    useState<LanguagePreference>(loadPreference);
  const [systemLocale, setSystemLocale] = useState<AppLocale>(browserLocale);
  const locale = preference === "system" ? systemLocale : preference;
  activeLocale = locale;

  useEffect(() => {
    const update = () => setSystemLocale(browserLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useEffect(() => {
    activeLocale = locale;
    void i18next.changeLanguage(locale);
    document.documentElement.lang = locale;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    if (description) {
      description.content =
        locale === "zh-CN"
          ? "Pi Coding Agent 的私有远程网页运行时"
          : "Private remote web runtime for Pi Coding Agent";
    }
  }, [locale]);

  const setPreference = useCallback((next: LanguagePreference) => {
    localStorage.setItem(languageStorageKey, next);
    setPreferenceState(next);
  }, []);

  const value = useMemo(
    () => ({ preference, locale, setPreference }),
    [locale, preference, setPreference]
  );

  return (
    <I18nextProvider i18n={i18next}>
      <LanguageContext.Provider value={value}>
        {children}
      </LanguageContext.Provider>
    </I18nextProvider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }
  return value;
}

export function getLocale(): AppLocale {
  return activeLocale;
}

export function t(
  source: string,
  values: Record<string, string | number> = {},
  locale = activeLocale
): string {
  return i18next.t(source, {
    ...values,
    lng: locale,
    defaultValue: source
  });
}

export function formatRelativeTime(value: string, locale = activeLocale): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "—";
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(elapsed / 60_000);
  if (Math.abs(minutes) < 1) return formatter.format(0, "minute");
  if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}

export const languageOptions: ReadonlyArray<{
  value: LanguagePreference;
  label: string;
}> = [
  { value: "system", label: "跟随系统" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "英语" }
];
