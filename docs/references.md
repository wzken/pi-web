# Research references

Pi interface facts come from the official documentation:

- <https://pi.dev/docs/latest>
- <https://pi.dev/docs/latest/rpc>
- <https://pi.dev/docs/latest/extensions>
- <https://pi.dev/docs/latest/session-format>
- <https://pi.dev/docs/latest/packages>
- <https://github.com/earendil-works/pi>

Architecture and interaction references were reviewed, not copied:

- `jmfederico/pi-web`: persistent workspaces, split daemon/web development,
  per-user services, remote-first operations, and a no-sandbox posture.
- `agegr/pi-web`: session browsing grouped by working directory, structured
  Markdown/tool presentation, context visibility, and file preview.
- `ygncode/pi-web`: deployment lessons, event streaming, JSONL watching,
  PWA/mobile layout, and local-network access.
- `cnbattle/pi-web`: pinned directory aliases, tool visibility, smart scroll,
  and caching for large sessions.

The implementation was written independently around official Pi interfaces.
