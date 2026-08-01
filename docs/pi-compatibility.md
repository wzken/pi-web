# Pi compatibility

The source and lockfile are tested against
`@earendil-works/pi-coding-agent@0.82.0` with Node.js 22.19 or newer. This is a
tested baseline, not a claim that the version remains the newest release.

## Confirmed interfaces

- Start: `pi --mode rpc`; useful options include `--name`, `--session`,
  `--session-dir`, `--provider`, `--model`, and `--no-session`.
- RPC framing uses LF only. A trailing CR is accepted; Unicode U+2028/U+2029
  remains content.
- Implemented commands include `prompt`, `steer`, `follow_up`, `abort`,
  `get_state`, `get_messages`, `get_available_models`, `set_model`,
  `get_available_thinking_levels`, `set_thinking_level`, and `switch_session`.
- Pi Web's global status uses only Pi CLI output from `--version`,
  `--list-models`, and `list`. It does not infer session capabilities by
  scanning Pi directories; those depend on the worker's cwd, project trust,
  settings, and loaded packages.
- Pi session version 3 begins with a session header followed by tree entries
  linked by `id` and `parentId`.
- Extensions load with `-e/--extension`, use `typebox` schemas, and register
  tools with `pi.registerTool`.
- Package operations are `pi install`, `pi remove`, `pi list`, and
  `pi update --extensions`. The global manager runs these commands from an
  isolated neutral cwd and exposes only Pi's `User packages` list. Project
  packages remain scoped to their worker cwd and are never removed or updated
  through the global user-package controls.

## Version policy

Startup and `doctor` report the installed version. Missing Pi blocks real
sessions and package mutations but not the web server, stored history, file
browser, configuration, or the fake-worker test suite.
