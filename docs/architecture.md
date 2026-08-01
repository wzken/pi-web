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

Every server request carries a rotating credential from a user-only runtime
file. A connection that successfully invokes the scheduler extension method is
fixed to the restricted extension role and cannot call server methods.

Requests have `id`, `method`, and `params`; responses echo `id`. Unsolicited
events carry `sessionId`, a monotonically increasing `sequence`, `type`,
`timestamp`, and a compact projection payload. Sessiond bounds reconnect state
by event count, bytes per session, and total retained sessions; tool results
remain in Pi history instead of being copied into this ring. When the requested
cursor predates the ring, the daemon returns a new snapshot from Pi JSONL plus
current worker state.

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
then stops all Pi workers before closing SQLite. The owner lease is released
only after that sequence succeeds, so a replacement daemon cannot overlap
with in-flight work from its predecessor.

The scheduler extension uses a short-lived, session-bound worker token and can
call only scheduler methods. It captures and then deletes token environment
variables during startup so normal tools do not inherit them.

## Session truth and recovery

Pi's JSONL file is the durable message and branch authority. An active Pi RPC
worker is authoritative for its current model, thinking level, queue, and
session statistics. SQLite stores only the Pi session reference, lifecycle
status, working directory, schedules, aggregates, command identity, audit
metadata, and Pi Web conversation-folder metadata; it does not duplicate the
message stream. On upgrade, Sessiond imports the legacy server-owned
`session-folders.json` once and leaves the source file in place as a recovery
artifact.

A server restart is lossless for active workers because they belong to
sessiond. A sessiond restart marks in-progress rows `interrupted`; v0.1 does
not claim mid-tool crash recovery. The browser treats its state as a
rebuildable projection: it synchronizes a snapshot or ordered replay before
applying buffered live events, detects sequence gaps, and requests a fresh
snapshot after daemon reconnects.

## Browser preferences

The interface language is a browser-local preference with `system`, `zh-CN`,
and `en-US` options. The web app uses `i18next`, `react-i18next`, and the
browser language detector; a compatibility adapter lets existing components
migrate to `useTranslation()` incrementally. The selected locale controls
document metadata, visible copy, accessibility labels, notifications, API
error presentation, and `Intl` date, number, currency, and relative-time
formatting.

Theme packages and appearance preferences remain server-managed so they can be
shared across the operator's browsers. Language and theme are independent:
each uploaded theme contains light and dark schemes but no translated product
copy. This is the intentional durable-state exception at the HTTP layer; theme
loading and its public semantic CSS contract are independent of Pi session
authority.

## Frontend styles

All application-owned stylesheets use CSS Modules. Components resolve semantic
class tokens through `ui()`, which adds the generated module class and retains
the semantic token as the public theme-pack contract. This keeps bundled rules
scoped without breaking installed themes. Third-party DOM, such as xterm's
internal `.xterm` node, is the only explicit `:global()` exception.

`pnpm lint:css-modules` rejects local non-module stylesheets, raw JSX class
strings, and dynamic class strings that bypass `ui()`.

## State transitions

`starting -> running -> waiting` is the normal turn. A new prompt returns
`waiting -> running`. Abort uses `running -> stopping -> waiting`; closing uses
`* -> stopping -> closed`. Unexpected process exit during active work is
`interrupted`; rejected startup and explicit agent errors are `failed`.

`waiting` means the current turn settled and the session is ready for more
input. It is never labelled as completed.
