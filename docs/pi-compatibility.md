# Pi compatibility

Pi Web requires Pi Coding Agent **0.84.1 or newer** with Node.js 22.19 or
newer. The scheduler extension is locked to
`@earendil-works/pi-coding-agent@0.84.4` in the source and lockfile.

## Compatibility kernel

Before the first real worker starts, sessiond runs a cached compatibility probe
from a neutral Pi Web cache directory. The probe verifies the installed version
and these required RPC commands without making a model request:

- `get_state`
- `get_available_models`
- `get_available_thinking_levels`
- `get_commands`
- `get_entries`
- `get_tree`

An older version or a missing required command rejects real session startup with
`PI_VERSION_UNSUPPORTED`. Stored history, the web server, file browsing,
configuration, and the fake-worker test suite remain usable. `pi-web doctor`
and the Settings doctor panel report the minimum version, compatibility result,
and detected RPC commands.

## Confirmed interfaces

- Workers start with `pi --mode rpc`; Pi Web uses `--name`, `--session`,
  `--fork`, `--extension`, `--no-session`, and `--append-system-prompt` where
  applicable.
- RPC framing uses LF JSONL. A trailing CR is accepted; Unicode U+2028/U+2029
  remains content.
- Session control uses `prompt`, `steer`, `follow_up`, `abort`, `get_state`,
  `get_messages`, model commands, thinking-level commands, and optional
  `get_session_stats`.
- A turn is complete only after `agent_settled`; `agent_end` alone is not used
  as the terminal lifecycle signal.
- Pi session version 3 begins with a session header followed by tree entries
  linked by `id` and `parentId`.
- New compactions use `retainedTail` as a self-contained current-context
  checkpoint. Older `firstKeptEntryId` sessions remain readable.
- Pi Web displays the complete active branch plus compaction markers. It does
  not replace durable history with `retainedTail`; retained messages are used
  only to reconstruct Pi's current model context.
- History pagination uses stable Pi entry IDs. Realtime projection recovery uses
  the separate `projectionEpoch + sequence` cursor.
- RPC Extension UI requests for `select`, `confirm`, `input`, and `editor` are
  held by sessiond and restored through snapshots. `notify` and the supported
  fire-and-forget methods are projected as bounded realtime notifications.
- Packages load with Pi's normal project and user scoping. Global controls use
  `pi install`, `pi remove`, `pi list`, and `pi update --extensions` from a
  neutral directory and expose only the `User packages` section.

## Upgrade policy

Package changes are blocked while workers are active unless the operator
explicitly confirms a forced change. Linux service `stop`, `restart`, and
`uninstall` commands also refuse active workers unless `--force` is supplied.
An authorized service change puts sessiond into drain mode before systemd is
invoked, preventing a new worker from entering between the check and restart.
A forced sessiond stop honestly marks active sessions interrupted; Pi Web does
not claim mid-tool process recovery.
