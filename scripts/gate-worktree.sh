#!/bin/sh
set -eu

# One implementation on every host. Keeping lease admission, heartbeat,
# cancellation, evidence, and process-fencing policy in gate-worktree.mjs
# prevents the POSIX and Windows delivery paths from drifting.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
NODE_BIN="${DPF_GATE_NODE_BIN:-node}"

if [ ! -f "$SCRIPT_DIR/gate-worktree.mjs" ]; then
  printf '%s\n' "gate-worktree: canonical gate-worktree.mjs is missing; refusing to record passing stub evidence" >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/gate-worktree.mjs" "$@"
