# Contributing

Thanks for helping improve Pi Web.

## Development setup

Requirements:

- Node.js 22.19 or newer
- pnpm 11.9.0

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --prod --registry=https://registry.npmjs.org
```

Run `git config core.hooksPath .githooks` once per clone. The hooks run the
required `/ponytail-review` before every commit and push; do not bypass them.

The normal test suite uses a fake process-level Pi RPC worker and does not
require provider credentials. Do not commit real access keys, Pi credentials,
SQLite databases, runtime folders, or workspace contents.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add or update regression tests for behavior changes.
- Preserve the single-user security model and allowed-root checks.
- Run `pnpm verify`, `pnpm test:e2e`, and
  `pnpm audit --prod --registry=https://registry.npmjs.org`.
- Update README or `docs/` when configuration, deployment, or behavior changes.
- Keep major dependency upgrades isolated and `@types/node` aligned with the
  supported Node runtime.

Use conventional, imperative commit subjects where practical, for example:

```text
fix: preserve stream deltas during batching
feat: add dual-mode theme manifests
docs: clarify Docker workspace mounts
```

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), not a public
issue.
