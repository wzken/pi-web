# Architecture

```text
Browser -- HTTP/WebSocket --> pi-web-server
                                  |\
                                  | \-- short-lived session PTYs
                                  | authenticated JSONL requests/events
                                  | Unix domain socket (0600)
                                  v
                             pi-web-sessiond
                             |      |       |
                           SQLite Cron   SessionSupervisor
                                              |
                                     one Pi RPC process
                                     per active session
```

The server is a thin transport and security boundary. It owns authentication,
HTTP security, static assets, browser WebSockets, safe file responses, and
interactive PTYs, but it does not own a Pi Coding Agent process or durable
session metadata. The session daemon is the Pi runtime authority and continues
when the server or browser goes away; server-owned terminals do not survive a
server restart.

## Internal protocol

`packages/protocol` is split by domain and exports one runtime `ipcContract`
registry. The registry is the source of truth for method names, request/result
types, and the server, extension, or handshake role. `packages/ipc` owns the
shared LF-delimited JSONL codec and typed Sessiond client; Server, CLI, Pi RPC,
Pi session reading, and the scheduler extension do not carry private copies of
that transport code.

Server HTTP modules keep route wiring separate from filesystem mechanics:
`files.ts` delegates workspace mutations, attachment publication, and safe raw
responses to focused modules, while `themes.ts` delegates ZIP and asset
validation to `theme-package.ts`.

Every IPC connection starts with an authenticated, versioned handshake. The
server and scheduler extension both require `protocolVersion = 3`; an
incompatible peer is rejected before business methods are accepted. Version 2
adds persistent notification inbox and Web Push delivery methods plus global
notification and notification-refresh events. A connection is permanently
bound to either the server role or the restricted scheduler-extension role.

Requests have `id`, `method`, and `params`; responses echo `id`. Unsolicited
events carry `sessionId`, a sessiond-instance `projectionEpoch`, a monotonically
increasing per-session `sequence`, `type`, `timestamp`, and a compact projection
payload. Sequence values are comparable only inside one epoch. When the browser
presents a different epoch, sessiond always returns a new authoritative
snapshot rather than attempting incremental replay.

Sessiond bounds reconnect state by event count, bytes per session, and total
retained sessions; tool results remain in Pi history instead of being copied
into this ring. When the requested sequence predates the ring, the daemon
returns a new snapshot from Pi JSONL plus current worker state.

Create, resume, and prompt requests may carry a mutation ID. Create IDs are
bound to their request in SQLite and remain incomplete until the worker starts
and the initial prompt is accepted, so a retry can recover the original session.
Accepted active-worker commands use a bounded Sessiond dedupe window. Reusing
an ID for different input is rejected.

Sessiond acquires an exclusive PID-and-nonce owner lease before opening SQLite.
CLI operations use live Sessiond IPC when available and must acquire the same
lease before any offline database access. This prevents the daemon startup
window from creating a second lifecycle or authentication authority.
Shutdown closes the scheduler and IPC admission gates, drains accepted work,
then stops all Pi workers before closing SQLite. Package changes and authorized
Linux service changes first place the Supervisor into an owned drain state so
new workers cannot cross the check/execute boundary. Service stop, restart, and
uninstall refuse active workers unless the operator explicitly uses `--force`;
forced changes are audited. If a systemd operation fails, the CLI cancels the
drain before returning the error. The owner lease is released only after
shutdown succeeds, so a replacement daemon cannot overlap with in-flight work
from its predecessor.

The scheduler extension uses a short-lived, session-bound worker token and can
call only scheduler methods. It captures and then deletes token environment
variables during startup so normal tools do not inherit them.

## Sessiond persistence and services

Sessiond opens one WAL-mode SQLite connection and composes concrete stores over
it: `SessionStore`, `ScheduleStore`, `NotificationStore`, `DirectoryStore`,
`SettingsStore`, `AuthStore`, and `AuditStore`. `DashboardReader` owns aggregate
read queries. Stores share the connection and Sessiond transaction boundary;
there is no ORM, generic repository, or dependency-injection container.

Runtime services receive only the stores they use. `SessionSupervisor` depends
on `SessionStore`, `Scheduler` on `ScheduleStore`, `NotificationCenter` on
`NotificationStore`, and the IPC handler groups receive their explicit stores
and services. `SessionDatabase` is the persistence composition and connection
lifetime owner rather than a business-logic facade.

IPC handlers are composed by domain—sessions/folders, schedules, notifications/
Push, and core service/settings operations—and every handler map is checked
against the result type in `ipcContract`.

`SessionSupervisor` remains the lifecycle orchestrator, while owned mutable
state is separated into `RuntimeRegistry`, `SessionHistory`, and
`ExtensionInteractions`. This keeps worker ownership, reconnect history, and
blocked extension dialogs independently maintainable without splitting every
use case into a class.

## Session truth and recovery

Pi's JSONL file is the durable message and branch authority. Pi Web paginates
the complete active branch with stable Pi entry IDs and renders compaction
entries as markers. The model's current context is a separate projection:
newer `retainedTail` compactions are self-contained context checkpoints, while
older sessions use `firstKeptEntryId`. Retained messages are never substituted
for or duplicated into the displayed durable history.

An active Pi RPC worker is authoritative for its current model, thinking level,
queue, pending Extension UI interactions, and session statistics. SQLite stores
the Pi session reference, lifecycle status, working directory, schedules,
aggregates, command identity, audit metadata, Pi Web conversation-folder
metadata, supervision notifications, Push subscriptions, and per-subscription
delivery attempts; it does not duplicate the message stream. On upgrade,
Sessiond imports the legacy server-owned `session-folders.json` once and leaves
the source file in place as a recovery artifact.

A server restart is lossless for active workers because they belong to
sessiond. A sessiond restart marks in-progress rows `interrupted`; v0.1 does
not claim mid-tool crash recovery. The browser treats its state as a
rebuildable projection: it synchronizes a snapshot or an ordered replay inside
the current epoch before applying buffered live events, detects sequence gaps
or epoch changes, and requests a fresh snapshot after daemon reconnects.

Pi RPC Extension UI dialog requests (`select`, `confirm`, `input`, and
`editor`) are held in the active Worker runtime and included in snapshots, so a
browser refresh does not lose a blocked interaction. Authenticated responses
are mutation-deduplicated and only one client can resolve an interaction.
Sessiond also creates a persistent, idempotent supervision notification for the
pending interaction. Resolving, expiring, or clearing the interaction resolves
the matching notification and cancels any Push delivery that has not yet been
sent.

Sessiond creates persistent notifications for pending Extension UI decisions,
settled non-scheduled turns, unexpected Worker/startup failures, and failed,
timed-out, or overlap-skipped schedule runs. Stable dedupe keys prevent replay,
reconnect, or repeated status callbacks from duplicating an incident. Single
notification changes are broadcast over IPC with the record; bulk read changes
use a body-free refresh signal so every browser reloads authoritative counts
without a broadcast storm. SQLite notification rows are supervision metadata,
not a second copy of Pi messages.

The Fastify server owns delivery, not notification truth. It generates one VAPID
key pair and persists it through sessiond, registers per-browser Push
subscriptions, drains per-notification/per-subscription delivery rows, retries
transient failures at most three times, and removes subscriptions rejected with
HTTP 404 or 410. A short delivery window lets a visible target session mark a
new notification read before a redundant background Push is sent. Lock-screen
payloads contain only the event type and session or schedule name plus an
authenticated Pi Web deep link; prompts, Extension descriptions, tool output,
paths, credentials, and error details are excluded. Resetting the access key
transactionally removes every Push subscription, while normal sign-out removes
the current device.

## Browser preferences

The interface language and completion sound are browser-local preferences.
Unread and needs-attention state are not browser-local: they are projections of
the sessiond-owned notification inbox and synchronize across authenticated
browsers. Background Push subscription state comes from the browser Service
Worker plus the server-side subscription row rather than a local boolean flag.
The web app keeps two complete locale catalogs and a small browser-local
language context. Chinese source strings are translation keys; English lookup
uses the English catalog with source fallback and simple named interpolation.
The selected locale controls document metadata, visible copy, accessibility
labels, notifications, API error presentation, and `Intl` date, number,
currency, and relative-time formatting.

Theme packages and appearance preferences remain server-managed so they can be
shared across the operator's browsers. Language and theme are independent:
each uploaded theme contains light and dark schemes but no translated product
copy. This is the intentional durable-state exception at the HTTP layer; theme
loading and its public semantic CSS contract are independent of Pi session
authority.

## Frontend styles

The application shell uses one ordered global `app.css` because its semantic
class names are the public theme-pack contract. `ui()` now only normalizes and
deduplicates those semantic tokens instead of attaching a generated class from
every historical stylesheet. Component-owned styles that are not part of the
theme contract remain CSS Modules.

`pnpm lint:css-modules` permits only `app.css` as application-global CSS,
rejects other local non-module stylesheets, and rejects raw or dynamic JSX
class strings that bypass `ui()`.

## State transitions

`starting -> running -> waiting` is the normal turn. A new prompt returns
`waiting -> running`. Abort uses `running -> stopping -> waiting`; closing uses
`* -> stopping -> closed`. Unexpected process exit during active work is
`interrupted`; rejected startup and explicit agent errors are `failed`.

`waiting` means the current turn settled and the session is ready for more
input. It is never labelled as completed.
