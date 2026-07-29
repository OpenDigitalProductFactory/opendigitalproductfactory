#!/bin/sh
set -eu

# dev-portal-lease.sh — lease-gate the :3001 Contributor preview.
#
# Per the accepted spec docs/superpowers/specs/2026-06-05-unified-delivery-
# surfaces-execution-alignment-design.md (§4.3 "Every shared singleton runtime
# MUST be lease-gated — including :3001" and §7 decision #5 "fold :3001 into the
# local-integration-ci lease"), the `dev-portal` container on :3001 is a single
# shared, live-DB-writing singleton bind-mounted to ONE worktree at a time via
# DPF_DEV_WORKTREE. Whoever runs `dev-portal-start` last silently re-points
# :3001 at their own worktree, so every other thread's "preview" is now showing
# someone else's code — and a coding mistake there mutates production data.
#
# This script makes the claim explicit: it claims the SAME governed lease the
# pre-PR CI gate uses (environmentKey="local-integration-ci") before :3001 is
# bound, surfaces who currently holds it, and refuses to silently re-bind while
# another holder is active. It does NOT touch docker; it only gates the claim.
#
# Subcommands:
#   claim    Claim the shared lease for the :3001 preview. On conflict, prints
#            the current holder and exits non-zero instead of silently
#            re-binding. Prints LEASE_ID=<id> on success.
#   status   Print the active lease holder for :3001 (if any). Exit 0 always.
#   release  Release a lease previously claimed for the preview. Pass the lease
#            id via --lease-id or DPF_DEV_PORTAL_LEASE_ID.
#
# Reuses the same MCP tools as scripts/gate-worktree.sh:
#   claim_nonprod_environment_lease / list_nonprod_environment_leases /
#   release_nonprod_environment_lease.

MCP_URL="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"
ENVIRONMENT_KEY="${DPF_DEV_PORTAL_ENVIRONMENT_KEY:-local-integration-ci}"
OWNER_PROVIDER="${DPF_DEV_PORTAL_OWNER_PROVIDER:-claude}"
OWNER_SESSION_ID="${DPF_DEV_PORTAL_OWNER_SESSION_ID:-}"
EXPIRES_MINUTES="${DPF_DEV_PORTAL_EXPIRES_MINUTES:-120}"
URL="${DPF_DEV_PORTAL_URL:-http://localhost:3001}"
PORTS="${DPF_DEV_PORTAL_PORTS:-3001}"
WORKTREE_PATH="${DPF_DEV_WORKTREE:-}"
BRANCH=""
LEASE_ID="${DPF_DEV_PORTAL_LEASE_ID:-}"
GIT_BIN="${DPF_DEV_PORTAL_GIT_BIN:-git}"
CURL_BIN="${DPF_DEV_PORTAL_CURL_BIN:-curl}"
DOCKER_BIN="${DPF_DEV_PORTAL_DOCKER_BIN:-docker}"
COMMAND=""

usage() {
  cat <<'EOF'
Usage: scripts/dev-portal-lease.sh <claim|refresh|status|release> [options]

Lease-gate the :3001 Contributor preview against the governed shared
local-integration-ci lease so it stops being an unleased shared singleton that
silently re-binds between worktrees and writes to the live DB.

Subcommands:
  claim     Claim the shared lease for :3001 before binding the preview.
            Refuses (non-zero) when another holder is active and prints them.
  refresh   Claim the lease, stop the shared preview, and restart it from this
            worktree. Keeps the lease on success; releases it on startup failure.
  status    Print the current holder for the shared lease (if any).
  release   Release a lease previously claimed for the preview.

Options:
  --worktree PATH         Worktree to bind (default: $DPF_DEV_WORKTREE).
  --owner-provider NAME   build-studio|claude|codex|coworker (default: claude).
  --owner-session-id ID   External session id (default: dev-portal-<pid>).
  --expires-minutes N     Lease expiry window (default: 120).
  --lease-id ID           Lease id to release (release only).
  --mcp-url URL           MCP endpoint (default: DPF_MCP_URL or local portal).
  --help                  Show this help.

Environment:
  DPF_MCP_BEARER_TOKEN    Required for claim/status/release (MCP auth).
  DPF_DEV_WORKTREE        Absolute worktree path (forward slashes).
EOF
}

die() {
  printf '%s\n' "dev-portal-lease: $*" >&2
  exit 1
}

json_escape() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$1"
}

json_array_numbers() {
  node -e 'const xs=(process.argv[1]||"").split(",").filter(Boolean).map(Number); process.stdout.write(JSON.stringify(xs));' "$1"
}

mcp_call() {
  tool_name="$1"
  arguments_json="$2"
  request_json="$(node -e '
const name = process.argv[1];
const args = JSON.parse(process.argv[2]);
process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}}));
' "$tool_name" "$arguments_json")"
  "$CURL_BIN" -sS -X POST "$MCP_URL" \
    -H "Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$request_json"
}

extract_tool_result() {
  node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
const payload = JSON.parse(raw);
const content = payload.result && Array.isArray(payload.result.content) ? payload.result.content : [];
const text = content.find((entry) => entry && entry.type === "text" && typeof entry.text === "string");
const parsed = text ? JSON.parse(text.text) : (payload.result && payload.result.structuredContent) || payload.result || payload;
process.stdout.write(JSON.stringify(parsed));
'
}

field() {
  node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
const obj = JSON.parse(raw);
const path = process.argv[1].split(".");
let value = obj;
for (const part of path) value = value == null ? undefined : value[part];
if (value !== undefined && value !== null) process.stdout.write(String(value));
' "$1"
}

# Describe a holder lease (JSON) as a human line, for the conflict / status path.
describe_holder() {
  node -e '
const fs = require("node:fs");
const lease = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
if (!lease || !lease.leaseId) { process.stdout.write(""); process.exit(0); }
const parts = [
  `lease ${lease.leaseId}`,
  `provider ${lease.ownerProvider || "?"}`,
  `session ${lease.ownerSessionId || "?"}`,
];
if (lease.branchName) parts.push(`branch ${lease.branchName}`);
if (lease.worktreePath) parts.push(`worktree ${lease.worktreePath}`);
if (lease.url) parts.push(`url ${lease.url}`);
if (lease.expiresAt) parts.push(`expires ${lease.expiresAt}`);
process.stdout.write(parts.join(", "));
'
}

# Find the active lease (if any) for our environment key from a list response.
active_lease_for_env() {
  node -e '
const fs = require("node:fs");
const resp = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const key = process.argv[1];
const leases = (resp && resp.data && Array.isArray(resp.data.leases)) ? resp.data.leases : [];
const match = leases.find((l) => l && l.environmentKey === key);
process.stdout.write(match ? JSON.stringify(match) : "");
' "$1"
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    claim|refresh|status|release) COMMAND="$1"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown subcommand: $1 (expected claim|refresh|status|release)" ;;
  esac
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) WORKTREE_PATH="${2:-}"; shift 2 ;;
    --owner-provider) OWNER_PROVIDER="${2:-}"; shift 2 ;;
    --owner-session-id) OWNER_SESSION_ID="${2:-}"; shift 2 ;;
    --expires-minutes) EXPIRES_MINUTES="${2:-}"; shift 2 ;;
    --lease-id) LEASE_ID="${2:-}"; shift 2 ;;
    --mcp-url) MCP_URL="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$COMMAND" ] || { usage; exit 2; }
[ -n "${DPF_MCP_BEARER_TOKEN:-}" ] || die "DPF_MCP_BEARER_TOKEN is required to talk to the DPF MCP lease tools"

[ -n "$OWNER_SESSION_ID" ] || OWNER_SESSION_ID="dev-portal-$$"
if [ -z "$BRANCH" ]; then
  BRANCH="$("$GIT_BIN" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'unknown')"
fi

release_lease() {
  lease_id_to_release="$1"
  release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id_to_release")}" | extract_tool_result)"
  release_success="$(printf '%s' "$release_response" | field success)"
  [ "$release_success" = "true" ] || return 1
  printf 'released %s\n' "$lease_id_to_release"
}

claim_lease() {
  [ -n "$WORKTREE_PATH" ] || die "DPF_DEV_WORKTREE (or --worktree) must be set so the lease records which worktree :3001 is bound to"
  expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 60000).toISOString())' "$EXPIRES_MINUTES")"
  claim_args="$(node -e '
const args = {
  environmentKey: process.argv[1],
  ownerProvider: process.argv[2],
  ownerSessionId: process.argv[3],
  claimKey: `dev-portal:${process.argv[3]}:${process.argv[5]}`,
  purpose: `Contributor preview (:3001) bound to ${process.argv[4]} @ ${process.argv[5]}`,
  url: process.argv[6],
  ports: JSON.parse(process.argv[7]),
  expiresAt: process.argv[8],
  worktreePath: process.argv[4],
  branchName: process.argv[5],
  cleanupCommand: "docker compose -p dpf --profile dev rm -sf dev-portal"
};
process.stdout.write(JSON.stringify(args));
' "$ENVIRONMENT_KEY" "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$WORKTREE_PATH" "$BRANCH" "$URL" "$(json_array_numbers "$PORTS")" "$expires_at")"
  claim_response="$(mcp_call claim_nonprod_environment_lease "$claim_args" | extract_tool_result)"
  claim_success="$(printf '%s' "$claim_response" | field success)"
  claim_error="$(printf '%s' "$claim_response" | field error)"
  if [ "$claim_success" = "true" ]; then
    CLAIMED_LEASE_ID="$(printf '%s' "$claim_response" | field entityId)"
    [ -n "$CLAIMED_LEASE_ID" ] \
      || CLAIMED_LEASE_ID="$(printf '%s' "$claim_response" | field data.lease.leaseId)"
    [ -n "$CLAIMED_LEASE_ID" ] \
      || die "lease claim succeeded without returning a lease id"
    admission_status="$(printf '%s' "$claim_response" | field data.admission.status)"
    if [ "$admission_status" = "queued" ]; then
      queue_position="$(printf '%s' "$claim_response" | field data.admission.queuePosition)"
      printf '%s\n' "WAITING lease ${CLAIMED_LEASE_ID} is queued at position ${queue_position:-unknown}; :3001 is not owned yet." >&2
      printf '%s\n' "Retry this same claim after the admitted holder releases; the stable claim key preserves FIFO position." >&2
      return 3
    fi
    printf 'LEASE_ID=%s\n' "$CLAIMED_LEASE_ID"
    printf 'admitted %s for :3001 -> %s (%s)\n' "$ENVIRONMENT_KEY" "$WORKTREE_PATH" "$BRANCH"
    return 0
  fi
  if [ "$claim_error" = "lease_conflict" ]; then
    holder="$(printf '%s' "$claim_response" | field data.active)"
    # data.active is an object; re-extract it as JSON for describe_holder.
    holder_json="$(node -e '
const fs = require("node:fs");
const resp = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const active = resp && resp.data && resp.data.active ? resp.data.active : null;
process.stdout.write(active ? JSON.stringify(active) : "");
' <<EOF
$claim_response
EOF
)"
    holder_line="$(printf '%s' "$holder_json" | describe_holder)"
    printf '%s\n' "REFUSING to silently re-bind :3001." >&2
    printf '%s\n' "The shared ${ENVIRONMENT_KEY} lease is already held by: ${holder_line:-$holder}" >&2
    printf '%s\n' "Coordinate explicitly: ask that holder to release, or take over only after they release their lease (scripts/dev-portal-lease.sh release --lease-id <id>)." >&2
    return 3
  fi
  die "failed to claim ${ENVIRONMENT_KEY} lease for :3001: $claim_response"
}

case "$COMMAND" in
  status)
    list_response="$(mcp_call list_nonprod_environment_leases '{}' | extract_tool_result)"
    holder="$(printf '%s' "$list_response" | active_lease_for_env "$ENVIRONMENT_KEY")"
    if [ -n "$holder" ]; then
      printf 'HELD %s\n' "$(printf '%s' "$holder" | describe_holder)"
    else
      printf 'FREE no active lease on %s\n' "$ENVIRONMENT_KEY"
    fi
    exit 0
    ;;

  release)
    [ -n "$LEASE_ID" ] || die "release requires --lease-id (or DPF_DEV_PORTAL_LEASE_ID)"
    release_lease "$LEASE_ID" || die "failed to release lease $LEASE_ID"
    exit 0
    ;;

  claim)
    claim_lease
    exit 0
    ;;

  refresh)
    if [ -z "$WORKTREE_PATH" ]; then
      WORKTREE_PATH="$("$GIT_BIN" rev-parse --show-toplevel 2>/dev/null)" \
        || die "could not resolve the worktree to bind"
    fi
    claim_lease
    cleanup_failed_refresh() {
      refresh_status="$?"
      trap - EXIT HUP INT TERM
      [ "$refresh_status" -ne 0 ] || refresh_status=1
      if [ -n "${CLAIMED_LEASE_ID:-}" ]; then
        release_lease "$CLAIMED_LEASE_ID" >/dev/null 2>&1 || true
      fi
      exit "$refresh_status"
    }
    trap cleanup_failed_refresh EXIT HUP INT TERM
    "$DOCKER_BIN" compose -p dpf --profile dev stop dev-portal
    "$DOCKER_BIN" compose -p dpf --profile dev up -d dev-portal
    trap - EXIT HUP INT TERM
    printf '%s\n' "Contributor preview refreshed; lease remains held as $CLAIMED_LEASE_ID."
    printf '%s\n' "Release when verification ends: scripts/dev-portal-lease.sh release --lease-id $CLAIMED_LEASE_ID"
    exit 0
    ;;
esac
