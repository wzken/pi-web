# Pi Web

[English](README.md) | [简体中文](README.zh-CN.md)

Pi Web 是面向 [Pi Coding Agent](https://pi.dev) 的单用户、自托管 Web
运行环境。它让 Pi 会话持续运行在真实项目目录中，并可通过电脑或手机浏览器进行
监督，同时继续使用 Pi 自身的会话格式和能力体系。

本项目基于 Pi 官方接口独立实现。[研究参考](docs/references.md)中的项目仅用于
产品决策研究，本仓库不包含它们的源码或品牌资源。

## 界面预览

![Pi Web 安全登录界面](docs/assets/preview-login.png)

<table>
  <tr>
    <td width="68%"><img src="docs/assets/preview-session.png" alt="持久会话与工作区文件预览"></td>
    <td width="32%"><img src="docs/assets/preview-mobile.png" alt="Pi Web 移动端工作台"></td>
  </tr>
  <tr>
    <td align="center">持久会话与工作区文件预览</td>
    <td align="center">移动端工作台</td>
  </tr>
</table>

## 主要功能

- Fastify Web 服务与长期运行的 sessiond 守护进程相互分离。
- 每个活动会话对应一个严格 JSONL 协议的 `pi --mode rpc` Worker。
- 支持提示、立即引导、后续排队、停止、模型和思考级别切换。
- 通过事件重放或最新 Pi JSONL 快照恢复断线页面。
- 访问密钥登录、scrypt 哈希、HttpOnly Cookie、来源检查和登录节流。
- 受允许根目录约束的文件浏览、预览、上传、新建和重命名。
- 每个会话拥有受认证的 xterm.js 终端和移动端控制键。
- 五字段 Cron、IANA 时区、历史记录、重叠保护、超时和立即运行。
- 直接展示 Pi CLI 返回的版本、可用模型并仅管理用户级 Packages；项目级
  Packages、Skills、Extensions 和提示模板仍由每个 Pi Worker 根据项目上下文加载。
- 桌面与移动端响应式界面、命令面板、通知和 PWA。
- 支持跟随系统的简体中文与英文界面。
- 支持亮色、暗色和跟随系统的声明式 ZIP 主题包。
- Linux systemd 用户服务和非 root Docker Compose 部署。

## 主题包

Pi Neutral 是内置默认主题。下面两个可选示例包都同时包含亮色与暗色方案，
并支持跟随系统：

| 主题 | 源码 | 可安装 ZIP |
| --- | --- | --- |
| Geist Workbench | [主题源码](theme-packs/geist-workbench) | [下载 ZIP](theme-packs/dist/geist-workbench.zip) |
| Material 3 Workbench | [主题源码](theme-packs/material-3-workbench) | [下载 ZIP](theme-packs/dist/material-3-workbench.zip) |

设置页只选择管理员已经安装的主题包。ZIP 安装能力仍保留在兼容 API 与部署工具
中，但不再暴露在产品界面。主题格式、安全限制和恢复方法见
[主题包指南](theme-packs/README.md)。

## 环境要求

- Node.js 22.19 或更高版本。
- 使用源码构建时需要 pnpm 11。
- systemd 安装路径需要 Linux。
- 同一用户已经安装并配置 `@earendil-works/pi-coding-agent`。

当前兼容性基线为 Pi Coding Agent 0.82.0。测试使用进程级假 Pi RPC Worker，
不需要供应商凭据。

## 本地开发

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:sessiond
pnpm dev:server
pnpm dev:web
```

Vite 界面默认位于 `http://127.0.0.1:5173`，API 和 WebSocket 会代理到 8787
端口。

执行完整验证：

```bash
pnpm verify
pnpm test:e2e
pnpm audit --prod
```

## 部署

在发布目录中安装 Linux 用户服务：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm pi-web install
pnpm pi-web doctor
```

也可以启动独立的 Docker 部署：

```bash
cp .env.docker.example .env
mkdir -p .runtime/docker/data .runtime/docker/pi workspaces
docker compose build
docker compose run --rm pi-web node dist/index.js set-password
docker compose run --rm --entrypoint pi pi-web
# 在 Pi 中执行 /login，完成后退出。
docker compose up -d
```

两种部署方式、Windows PowerShell 命令、可信远程访问、更新与备份说明都在
[部署指南](docs/deployment.md)中。

## 配置

环境变量的优先级高于配置文件。

| 设置 | 默认值 |
| --- | --- |
| `PI_WEB_HOST` | `0.0.0.0` |
| `PI_WEB_PORT` | `8787` |
| `PI_WEB_ALLOWED_ROOTS` | 当前用户主目录 |
| `PI_WEB_ALLOW_ANY_DIRECTORY` | `false` |
| `PI_WEB_DEFAULT_TIMEZONE` | `UTC` |
| `PI_WEB_DEFAULT_CRON_TIMEOUT_SECONDS` | `3600` |
| `PI_WEB_MINIMUM_CRON_INTERVAL_MINUTES` | `5` |
| `PI_WEB_MODEL_SCHEDULE_POLICY` | `allow` |
| `PI_WEB_PI_EXECUTABLE` | `pi` |
| `PI_WEB_ACCESS_KEY` | 自动生成；只持久化哈希 |
| `PI_WEB_COOKIE_SECURE` | `auto` |

Linux 中多个允许根目录使用 `:` 分隔。

## 安全

> **Pi Web 不是安全沙箱。** Pi Worker 拥有启动它的用户或容器账号的权限。

Pi Web 不提供 HTTPS、VPN、公网中继或防火墙规则。不要把明文 HTTP 直接暴露到
不可信网络，应使用可信私网、SSH 隧道或 HTTPS 反向代理。

部署前请阅读[安全模型](docs/security-model.md)。漏洞报告流程见
[SECURITY.md](SECURITY.md)。

## 运行行为与限制

- 关闭浏览器或只重启 Web 服务不会停止由 sessiond 持有的 Pi Worker。
- 重启 sessiond 或主机会中断活动 Worker；v0.1 不承诺工具执行中的无损恢复。
- `waiting` 表示 Pi 可以继续接收输入，不代表整个会话已经结束。
- Linux 是正式支持的生产平台。
- 文件删除和覆盖暂不开放。
- Web 服务重启会终止其持有的终端进程。
- PWA 只缓存编译后的静态资源，不会离线保存认证后的会话内容。

明确的非目标见[项目范围](docs/scope.md)，调度保证见
[调度器语义](docs/scheduler.md)。

## 文档

- [项目范围](docs/scope.md)
- [系统架构](docs/architecture.md)
- [部署指南](docs/deployment.md)
- [安全模型](docs/security-model.md)
- [调度器](docs/scheduler.md)
- [Pi 兼容性](docs/pi-compatibility.md)
- [主题包](theme-packs/README.md)
- [参与贡献](CONTRIBUTING.md)
- [研究参考](docs/references.md)

## 路线图

完成 v0.1 可靠性后：更完整的分支导航、缓存感知的快照分页、可选的真实 Pi
兼容性 CI、更完善的安装包，以及深入的无障碍和性能分析。
多用户、集群、worktree、SaaS 和编排功能仍不在范围内。

## 许可证

[MIT](LICENSE)
