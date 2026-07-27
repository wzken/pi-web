# Security model

Pi Web assumes one trusted operator and trusted project directories. It is not
a tenant boundary or a sandbox.

## Controls

- A first-run access key contains 32 random bytes and is shown once.
- Only a scrypt hash and salt are persisted. When installation receives
  `PI_WEB_ACCESS_KEY`, its hash may be stored for service continuity; the
  plaintext key is never written to config, database, logs, or service units.
- Login sessions are random, HttpOnly, `SameSite=Strict` cookies. `Secure` is
  automatic under HTTPS and configurable for trusted TLS termination.
- Login attempts are serialized and throttled per source with increasing
  delay.
- State-changing requests and WebSocket handshakes validate Origin.
- CSP and other baseline response headers are enabled.
- The sessiond socket, rotating server IPC credential, config, data, and other
  token-bearing runtime files are user-only.
- Scheduler-extension connections are restricted to scheduler methods with a
  short-lived session-bound token.
- Every file target is resolved with `realpath` and checked against the current
  allowed roots, preventing `..`, symlink escapes, and stale access after roots
  are tightened.
- Untrusted HTML and SVG are not rendered as same-origin documents. Markdown
  is sanitized; unsupported files download as attachments.
- Package operations use an executable plus an argv array, never shell string
  concatenation. Sources and actions are allow-listed.
- Terminal WebSockets require an authenticated cookie and same-origin
  handshake. A terminal can start only after revalidating the session
  directory; sensitive environment variables are stripped before spawning the
  PTY.
- The pnpm workspace enforces a one-day minimum package release age,
  allow-lists install scripts, and commits its lockfile.
- Provider credentials and access keys are never returned through web APIs or
  written to ordinary audit events.

## Operator warnings

A Pi worker has the full permissions of the user or container account that
launched Pi Web. It can read files, write files, and execute commands.

Pi Web does not provide HTTPS, a VPN, a public relay, or firewall rules. Do not
expose plain HTTP directly to an untrusted network. Use a trusted private
network, an SSH tunnel, or a trusted HTTPS reverse proxy.

Back up Pi Web state and Pi's session directory before upgrades. Do not place
credential directories inside an allowed workspace root.

## Reporting a vulnerability

Do not open a public issue for an undisclosed vulnerability. Follow the private
reporting process in [SECURITY.md](../SECURITY.md).
