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
- Pi version, available models, and user-scoped Package operations surfaced
  from the Pi CLI; project packages, Skills, Extensions, and prompt templates
  remain the responsibility of each Pi worker and its project context.
- Responsive desktop/mobile UI, command palette, notifications, and PWA assets.
- System-aware Simplified Chinese and English interface.
- A low-distraction coding-agent workbench that follows the operating system's
  light or dark appearance automatically.
- A collapsible sidebar that treats working directories as projects and keeps
  recent chats, Package plugins, and schedules separate, with full history one
  click away through View all sessions.
- A phone-first chat surface with a full-screen navigation drawer, large touch
  targets, real attachment/runtime shortcuts, a bottom-anchored composer, and
  long-press actions to pin, rename, or delete recent sessions.
- Linux systemd user services and a non-root Docker Compose deployment.

## Requirements

- Node.js 22.19 or newer.
- pnpm 11 for source builds.
- Linux for the supported systemd installation path.
- `@earendil-works/pi-coding-agent` installed and configured for the same user.

The current compatibility baseline is Pi Coding Agent 0.82.0. Tests use a
process-level fake Pi RPC worker and do not require provider credentials.

## Quick start from source

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm pi-web start
```

On the first interactive start, Pi Web prints a generated access key once.
Store it, open `http://127.0.0.1:8787`, and sign in with that key. Pi and its
provider credentials are read from the same operating-system user that starts
Pi Web. Run `pnpm pi-web doctor` if the UI opens but Pi sessions cannot start.

The default allowed root is the current user's home directory. Set
`PI_WEB_ALLOWED_ROOTS` before starting Pi Web if sessions should be limited to
specific project directories. Separate multiple roots with `:` on Linux and
`;` on Windows.

## Typical workflow

1. Sign in with the Pi Web access key.
2. Choose a working directory under an allowed root, the model, thinking
   level, and optional system prompt, then create the session.
3. Send prompts, steer the active turn, queue follow-ups, or abort work from
   the session page.
4. Inspect workspace files and images or use the session terminal without
   stopping the Pi worker when the browser disconnects.
5. Create a schedule when a prompt needs to run later or repeatedly; each run
   creates a new Pi session and records its outcome.

## Development

```bash
pnpm install --frozen-lockfile
pnpm build
# Terminal 1
pnpm dev:sessiond
# Terminal 2
pnpm dev:server
# Terminal 3
pnpm dev:web
```

The Vite UI runs at `http://127.0.0.1:5173` and proxies API and WebSocket
requests to port 8787. Start sessiond before the server on a fresh runtime.

Run the full verification:

```bash
pnpm verify
pnpm test:e2e
pnpm audit --prod
```

The unit and integration suites use the fake Pi worker and need no provider
credentials. Playwright starts its own stateful backend and runs desktop and
mobile projects serially. See [Contributing](CONTRIBUTING.md) for change and
pull-request expectations.

## Project structure

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite PWA, session workbench, settings, files, terminal, and schedules |
| `apps/server` | Fastify HTTP/WebSocket boundary, authentication, static assets, file APIs, and PTYs |
| `apps/sessiond` | Durable session authority, SQLite state, Pi worker supervision, IPC, and Cron |
| `apps/cli` | Foreground startup, diagnostics, access-key management, and systemd installation |
| `packages/protocol` | Shared request, event, and domain contracts |
| `packages/pi-rpc` | Strict JSONL transport for `pi --mode rpc` |
| `packages/pi-session-reader` | Pi session JSONL parsing and snapshot reconstruction |
| `packages/config`, `packages/shared` | Configuration, paths, security helpers, and shared state logic |
| `packages/scheduler-extension` | Restricted Pi extension used to manage schedules |
| `tests`, `docs` | End-to-end/integration coverage and design documentation |

The browser talks only to `apps/server`. The server forwards authenticated
session operations over user-only local IPC to `apps/sessiond`, which owns
SQLite and one Pi RPC process per active session. Pi's own JSONL remains the
durable source of conversation content. See [Architecture](docs/architecture.md)
for recovery, ownership, and protocol details.

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

## CLI reference

Run commands from a built source checkout with `pnpm pi-web <command>`.

| Command | Purpose |
| --- | --- |
| `start` | Run sessiond and the web server together in the foreground |
| `server` / `sessiond` | Run one service for development or diagnostics |
| `install` | Install and start Linux systemd user services |
| `status` | Show the configured address and, on Linux, systemd state |
| `doctor` | Check Node, Pi, RPC, SQLite, IPC, roots, server health, and exposure |
| `set-password` | Set a custom access password through a hidden prompt |
| `reset-key` | Generate and persist a replacement access key; restart the server when prompted |
| `uninstall` | Remove systemd units while preserving configuration and data |
| `version` | Print the Pi Web version |

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
| `PI_WEB_TRUSTED_PROXY` | `false` |
| `PI_WEB_COOKIE_SECURE` | `auto` |
| `PI_WEB_DEFAULT_MODEL` | unset; use Pi's current default |
| `PI_WEB_DEFAULT_THINKING_LEVEL` | unset; use Pi's current default |
| `PI_WEB_DEFAULT_SYSTEM_PROMPT` | unset |
| `PI_WEB_MAX_SCHEDULED_JOBS` | `200` |
| `PI_WEB_MAX_CONCURRENT_WORKERS` | `8` |
| `PI_WEB_EVENT_BUFFER_SIZE` | `2000` events |

Configuration is loaded from `~/.config/pi-web/config.json` by default (or the
corresponding XDG configuration directory), then overridden by environment
variables. Multiple allowed roots use `:` on Linux and `;` on Windows.
Operational paths can be relocated with
`PI_WEB_CONFIG_DIR`, `PI_WEB_DATA_DIR`, and `PI_WEB_CACHE_DIR`; Docker Compose
sets these automatically inside the container.

When `PI_WEB_ACCESS_KEY` is set, that environment value owns the credential;
`set-password` and `reset-key` are disabled. Change the environment value and
restart the server instead. Treat `PI_WEB_ALLOW_ANY_DIRECTORY=true` as a
deliberate removal of workspace-root containment, not a convenience default.

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
- Deleting a session hides it from Pi Web's session index without removing Pi's
  original JSONL record.
- Web-server restarts terminate attached terminal processes.
- Authenticated session data is not available offline; the PWA caches only
  compiled static assets.

See [scope](docs/scope.md) for explicit non-goals and
[scheduler semantics](docs/scheduler.md) for scheduling guarantees.

## Documentation

- [Scope](docs/scope.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/decisions/README.md)
- [Deployment](docs/deployment.md)
- [Security model](docs/security-model.md)
- [Scheduler](docs/scheduler.md)
- [Pi compatibility](docs/pi-compatibility.md)
- [Contributing](CONTRIBUTING.md)
- [Research references](docs/references.md)

## Roadmap

After v0.1 reliability: richer branch navigation, cache-aware snapshot
pagination, optional real-Pi compatibility CI, improved packaging, and deeper
accessibility and performance profiling. Multi-user, fleet,
worktree, SaaS, and orchestration features remain out of scope.

## License

[MIT](LICENSE)
