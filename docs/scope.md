# Scope

Pi Web is a single-user, self-hosted, remote-first web runtime for Pi Coding
Agent. Pi remains the authority for conversation content and agent
capabilities.

## v0.1 commitments

- Linux-first deployment under an ordinary user account.
- Separate HTTP server and session daemon connected by authenticated,
  user-only local IPC.
- One `pi --mode rpc` subprocess per active session.
- Workers survive browser disconnects and HTTP server restarts.
- Pi session JSONL supplies messages, tool activity, branches, and usage facts.
- SQLite stores mappings, runtime state, schedules, aggregates, and minimal
  audit metadata.
- One strong access key, HttpOnly login cookies, Origin checks, and per-source
  login throttling.
- Five-field Cron with IANA zones, overlap skipping, timeouts, run history, and
  a restricted `pi_web_schedule` extension tool.
- Contained file browsing, native-safe previews, upload, create, rename, and
  relative-path copy. Destructive deletion and overwrite are excluded.
- Pi CLI version, available models, and user-scoped package operations are
  surfaced directly. Project packages, skills, extensions, and prompt templates
  remain session capabilities resolved by each Pi worker; Pi Web does not
  maintain a parallel resource registry.
- Declarative ZIP theme packs with dual light/dark modes and safe recovery.
- An authenticated per-session terminal constrained to the current allowed
  workspace roots, with a short reconnect window and explicit stop.

## Explicit non-goals

The product does not include multi-user roles, a multi-machine fleet, cloud
relay, automatic TLS, a sandbox, container workspace orchestration, worktree
management, in-product GitHub/PR workflows, sub-agent orchestration, a full
IDE, Office conversion, SaaS, or executable browser plugins.

Unavailable Pi capabilities are reported as unavailable rather than replaced
with fake production data.
