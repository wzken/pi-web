# AGENTS.md

## Git review gate

- Before every `git commit` and `git push`, run `/ponytail-review` against exactly the staged or pushed diff.
- Never bypass the review hooks with `--no-verify`.
- If the review cannot run, stop; do not commit or push.
- Address each finding or explicitly state why the current code is already the smaller solution before proceeding.
