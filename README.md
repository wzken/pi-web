# Pi Web

[English](README.md) | [简体中文](README.zh-CN.md)

Pi Web is a single-user, self-hosted web runtime for
[Pi Coding Agent](https://pi.dev). It keeps Pi sessions alive in real
workspaces and lets you supervise them from desktop or mobile browsers without
replacing Pi's session format or capability system.

This is an independent implementation. The projects listed in
[research references](docs/references.md) informed product decisions; their
source code and branding are not included here.

## Preview

![Pi Web secure access screen](docs/assets/preview-login.png)

<table>
  <tr>
    <td width="68%"><img src="docs/assets/preview-session.png" alt="Persistent session and workspace file preview"></td>
    <td width="32%"><img src="docs/assets/preview-mobile.png" alt="Pi Web mobile workbench"></td>
  </tr>
  <tr>
    <td align="center">Persistent session and workspace file preview</td>
    <td align="center">Mobile workbench</td>
  </tr>
</table>

## Features

- Separate Fastify server and long-running session daemon.
- One strict-JSONL `pi --mode rpc` worker for each active session.
- Prompt, steer, follow-up, abort, model selection, and thinking-level control.
- Reconnect through event replay or a fresh Pi JSONL snapshot.
- Access-key login with scrypt hashing, HttpOnly cookies, Origin validation,
  and login throttling.
- Root-constrained file browsing, preview, upload, create, and rename.
- An authenticated per-session xterm.js terminal with mobile controls.
- Five-field Cron schedules with IANA time zones, history, overlap protection,
  timeout, and run-now.
- Pi Packages, Skills, Extensions, templates, providers, and models.
- Responsive desktop/mobile UI, command palette, notifications, and PWA assets.
- System-aware Simplified Chinese and English interface.
- Declarative ZIP theme packs with light, dark, and system modes.
- Linux systemd user services and a non-root Docker Compose deployment.

## Included themes

Each ZIP contains both light and dark schemes and can follow the operating
system:

| Theme | Source | Installable ZIP |
| --- | --- | --- |
| Geist Workbench | [theme files](theme-packs/geist-workbench) | [download](theme-packs/dist/geist-workbench.zip) |
| Material 3 Workbench | [theme files](theme-packs/material-3-workbench) | [download](theme-packs/dist/material-3-workbench.zip) |

Import a ZIP from **Settings → Appearance → Theme packages**. The
[theme-pack guide](theme-packs/README.md) documents the manifest, safety
limits, and recovery mode.

## Requirements

- Node.js 22.19 or newer.
- pnpm 11 for source builds.
- Linux for the supported systemd installation path.
- `@earendil-works/pi-coding-agent` installed and configured for the same user.

The current compatibility baseline is Pi Coding Agent 0.82.0. Tests use a
process-level fake Pi RPC worker and do not require provider credentials.

## Development

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:sessiond
pnpm dev:server
pnpm dev:web
```

The Vite UI runs at `http://127.0.0.1:5173` and proxies API and WebSocket
requests to port 8787.

Run the full verification:

```bash
pnpm verify
pnpm test:e2e
pnpm audit --prod
```

## Deployment

Install Linux user services from a release checkout:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm pi-web install
pnpm pi-web doctor
```

Or start the self-contained Docker deployment:

```bash
cp .env.docker.example .env
mkdir -p .runtime/docker/data .runtime/docker/pi workspaces
docker compose build
docker compose run --rm pi-web node dist/index.js set-password
docker compose run --rm --entrypoint pi pi-web
# Run /login inside Pi, then exit.
docker compose up -d
```

Both deployment paths, Windows PowerShell commands, trusted remote access,
updates, and backups are covered in the
[deployment guide](docs/deployment.md).

## Configuration

Environment variables override the configuration file.

| Setting | Default |
| --- | --- |
| `PI_WEB_HOST` | `0.0.0.0` |
| `PI_WEB_PORT` | `8787` |
| `PI_WEB_ALLOWED_ROOTS` | current user's home |
| `PI_WEB_ALLOW_ANY_DIRECTORY` | `false` |
| `PI_WEB_DEFAULT_TIMEZONE` | `UTC` |
| `PI_WEB_DEFAULT_CRON_TIMEOUT_SECONDS` | `3600` |
| `PI_WEB_MINIMUM_CRON_INTERVAL_MINUTES` | `5` |
| `PI_WEB_MODEL_SCHEDULE_POLICY` | `allow` |
| `PI_WEB_PI_EXECUTABLE` | `pi` |
| `PI_WEB_ACCESS_KEY` | generated; only its hash is persisted |
| `PI_WEB_COOKIE_SECURE` | `auto` |

Multiple allowed roots use `:` on Linux.

## Security

> **Pi Web is not a sandbox.** A Pi worker has the permissions of the user or
> container account that launched it.

Pi Web does not provide HTTPS, a VPN, a public relay, or firewall rules. Never
expose plain HTTP directly to an untrusted network. Use a trusted private
network, an SSH tunnel, or an HTTPS reverse proxy.

Read the [security model](docs/security-model.md) before deployment. Report
vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## Runtime behavior and limits

- Closing the browser or restarting only the web server does not stop Pi
  workers owned by sessiond.
- Restarting sessiond or the host interrupts active workers; v0.1 does not
  promise lossless mid-tool recovery.
- `waiting` means Pi is ready for more input, not that the session is finished.
- Linux is the supported production platform.
- File deletion and overwrite are intentionally unavailable.
- Web-server restarts terminate attached terminal processes.
- Authenticated session data is not available offline; the PWA caches only
  compiled static assets.

See [scope](docs/scope.md) for explicit non-goals and
[scheduler semantics](docs/scheduler.md) for scheduling guarantees.

## Documentation

- [Scope](docs/scope.md)
- [Architecture](docs/architecture.md)
- [Deployment](docs/deployment.md)
- [Security model](docs/security-model.md)
- [Scheduler](docs/scheduler.md)
- [Pi compatibility](docs/pi-compatibility.md)
- [Theme packs](theme-packs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Research references](docs/references.md)

## Roadmap

After v0.1 reliability: richer branch navigation, cache-aware snapshot
pagination, optional real-Pi compatibility CI, improved packaging, and deeper
accessibility and performance profiling. Multi-user, fleet,
worktree, SaaS, and orchestration features remain out of scope.

## License

[MIT](LICENSE)
