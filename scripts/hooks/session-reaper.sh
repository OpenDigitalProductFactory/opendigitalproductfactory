#!/bin/sh
# scripts/hooks/session-reaper.sh
#
# SessionEnd sidecar reaper (POSIX). Counterpart of session-reaper.ps1.
#
# Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-
#       alignment-design.md S4.2 ("Session = claimed capsule; session end =
#       reap"). Terminates THIS session's orphaned per-session MCP/node sidecars
#       (node_repl, node, npx MCP children) and releases any held lease/capsule
#       so the next session and a tool upgrade are not blocked.
#
# Invoked by the .claude/settings.json SessionEnd hook via run-hook.mjs.
# Receives a JSON payload on stdin:
#   { "session_id": "...", "cwd": "<worktree path>",
#     "hook_event_name": "SessionEnd" }
#
# Requires: jq (same dependency as transcript-snapshot.sh). Absent jq = skip.
# Exit 0 ALWAYS -- a reap failure must never block session teardown.
#
# Conservative: only sidecar processes whose command line references THIS
# worktree are reaped, so a concurrent session in another worktree is spared,
# and the operator's editor / browser / portal / docker stack is never touched.

set -u

PAYLOAD="$(cat || true)"
[ -n "$PAYLOAD" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)"
HOOK_EVENT="$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty' 2>/dev/null)"
CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null)"

# Only act on session-end; a misrouted event must no-op.
if [ -n "$HOOK_EVENT" ] && [ "$HOOK_EVENT" != "SessionEnd" ]; then exit 0; fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
. "$SCRIPT_DIR/lib/session-reaper-path.sh"
WORKTREE_PATH="${CWD:-$INSTALL_ROOT}"
# Trim trailing slash for substring matching.
WORKTREE_PATH="${WORKTREE_PATH%/}"

STATE_DIR="$HOME/.claude/hook-state"
LOG_FILE="$STATE_DIR/session-reaper.log"
mkdir -p "$STATE_DIR" 2>/dev/null || true

REAPED_LEASE=false
REAPED_COUNT=0

# --- 1. Release THIS session's nonprod lease(s) / work capsule via the DPF MCP
#
# Owner-scoped on purpose (BI-B0122A22): the release tool requires a leaseId and
# the server refuses a release by a different owner, so we first list the live
# leases, keep only the ones this session_id owns, and release each by id. The
# former `{"environmentKey":...}` call was refused by the server every time and
# only ever produced a misleading `lease_released:true` audit line.
MCP_ENDPOINT="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"
mcp_call() {
  _body="$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$1" "$2")"
  curl -s --max-time 5 -X POST "$MCP_ENDPOINT" \
    -H "Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data "$_body" 2>/dev/null
}
if [ -n "${DPF_MCP_BEARER_TOKEN:-}" ] && [ -n "$SESSION_ID" ] && command -v curl >/dev/null 2>&1; then
  _listing="$(mcp_call list_nonprod_environment_leases '{}')"
  # The tool result travels as JSON text inside the JSON-RPC envelope; pull every
  # leaseId whose ownerSessionId is this session, from active and queued alike.
  _mine="$(printf '%s' "$_listing" \
    | tr -d '\\' \
    | grep -oE '"leaseId":"NPEL-[A-Z0-9]+"[^}]*"ownerSessionId":"'"$SESSION_ID"'"' \
    | grep -oE 'NPEL-[A-Z0-9]+' \
    | sort -u)"
  for _lease in $_mine; do
    if mcp_call release_nonprod_environment_lease \
        "$(printf '{"leaseId":"%s","ownerSessionId":"%s"}' "$_lease" "$SESSION_ID")" \
        | grep -q '"success":true'; then
      REAPED_LEASE=true
    fi
  done
  mcp_call release_capsule_scope '{}' >/dev/null || true
fi

# --- 2. Reap THIS session's orphaned MCP/node sidecars -----------------------
#
# Match sidecar process command lines that reference this worktree. `ps -ww`
# gives full args; we filter to node/node_repl/npx and grep for the worktree.
if command -v ps >/dev/null 2>&1; then
  # Collect candidate PIDs: lines whose command references the worktree AND is
  # one of the sidecar binaries. Self-PID is excluded.
  SELF_PID=$$
  PIDS="$(ps -ww -eo pid=,args= 2>/dev/null \
    | grep -E '(^| )([^ ]*/)?(node|node_repl|npx)( |$)' \
    | while IFS= read -r _line; do
        dpf_process_line_matches_worktree "$_line" "$WORKTREE_PATH" && printf '%s\n' "$_line"
      done \
    | awk '{print $1}')"
  for _pid in $PIDS; do
    [ "$_pid" = "$SELF_PID" ] && continue
    if kill -TERM "$_pid" 2>/dev/null; then
      REAPED_COUNT=$((REAPED_COUNT + 1))
    fi
  done
fi

# --- Audit log ---------------------------------------------------------------
_ts="$(date -u +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || echo unknown)"
printf '{"timestamp":"%s","session_id":"%s","hook_event":"%s","worktree":"%s","lease_released":%s,"reaped_count":%d}\n' \
  "$_ts" "$SESSION_ID" "$HOOK_EVENT" "$WORKTREE_PATH" "$REAPED_LEASE" "$REAPED_COUNT" \
  >> "$LOG_FILE" 2>/dev/null || true

exit 0
