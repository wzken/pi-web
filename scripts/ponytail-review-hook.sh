#!/bin/sh
set -eu

mode=${1:?expected commit or push}
root=$(git rev-parse --show-toplevel)
cd "$root"

pi_bin=$(command -v pi || true)
if [ -z "$pi_bin" ] && [ -x "$HOME/.pi/agent/bin/pi" ]; then
  pi_bin="$HOME/.pi/agent/bin/pi"
fi
if [ -z "$pi_bin" ]; then
  echo "ponytail-review: pi is required; refusing to $mode" >&2
  exit 1
fi

diff_file=$(mktemp)
trap 'rm -f "$diff_file"' EXIT

case "$mode" in
  commit)
    git diff --cached --no-ext-diff --no-color --stat >"$diff_file"
    git diff --cached --no-ext-diff --no-color >>"$diff_file"
    ;;
  push)
    empty_tree=$(git hash-object -t tree /dev/null)
    while read -r local_ref local_sha remote_ref remote_sha; do
      [ -n "${local_ref:-}" ] || continue
      printf '\n%s %s -> %s %s\n' "$local_ref" "$local_sha" "$remote_ref" "$remote_sha" >>"$diff_file"
      case "$local_sha" in
        0000000000000000000000000000000000000000) continue ;;
      esac
      case "$remote_sha" in
        0000000000000000000000000000000000000000)
          git diff --no-ext-diff --no-color "$empty_tree" "$local_sha" >>"$diff_file"
          ;;
        *)
          git diff --no-ext-diff --no-color "$remote_sha" "$local_sha" >>"$diff_file"
          ;;
      esac
    done
    ;;
  *)
    echo "ponytail-review: unknown mode: $mode" >&2
    exit 2
    ;;
esac

printf 'Running /ponytail-review before git %s...\n' "$mode" >&2
{
  printf 'Review target: git %s\n\n' "$mode"
  cat "$diff_file"
} | PI_SKIP_VERSION_CHECK=1 "$pi_bin" --print --no-session --approve --tools read \
  "/skill:ponytail-review Review only the supplied git diff. Do not edit files."
