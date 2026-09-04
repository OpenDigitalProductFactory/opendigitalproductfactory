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
# another holder is active. The refresh command remains in the foreground as
# the lease keeper; losing authority stops the shared preview before it can run
# unfenced.
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
#   renew_nonprod_environment_lease / release_nonprod_environment_lease.

MCP_URL="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"
ENVIRONMENT_KEY="${DPF_DEV_PORTAL_ENVIRONMENT_KEY:-local-integration-ci}"
OWNER_PROVIDER="${DPF_DEV_PORTAL_OWNER_PROVIDER:-claude}"
OWNER_SESSION_ID="${DPF_DEV_PORTAL_OWNER_SESSION_ID:-}"
EXPIRES_MINUTES="${DPF_DEV_PORTAL_EXPIRES_MINUTES:-120}"
MAX_TERMINAL_CLAIM_ATTEMPTS="${DPF_DEV_PORTAL_MAX_TERMINAL_CLAIM_ATTEMPTS:-64}"
URL="${DPF_DEV_PORTAL_URL:-http://localhost:3001}"
PORTS="${DPF_DEV_PORTAL_PORTS:-3001}"
WORKTREE_PATH="${DPF_DEV_WORKTREE:-}"
BRANCH=""
LEASE_ID="${DPF_DEV_PORTAL_LEASE_ID:-}"
GIT_BIN="${DPF_DEV_PORTAL_GIT_BIN:-git}"
CURL_BIN="${DPF_DEV_PORTAL_CURL_BIN:-curl}"
DOCKER_BIN="${DPF_DEV_PORTAL_DOCKER_BIN:-docker}"
HEARTBEAT_SECONDS="${DPF_DEV_PORTAL_HEARTBEAT_SECONDS:-30}"
HEARTBEAT_TTL_MINUTES="${DPF_DEV_PORTAL_HEARTBEAT_TTL_MINUTES:-2}"
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
            worktree. Stays in the foreground to renew authority; stopping the
            keeper stops the preview and releases the lease.
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
  DPF_DEV_PORTAL_MAX_TERMINAL_CLAIM_ATTEMPTS
                          Bounded historical terminal-key scan (default: 64).
  DPF_DEV_PORTAL_HEARTBEAT_SECONDS
                          Active-lease renewal cadence (default: 30 seconds).
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

sample_host_pressure() {
  if [ -n "${DPF_DEV_PORTAL_HOST_PRESSURE_JSON:-}" ]; then
    node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(value));' \
      "$DPF_DEV_PORTAL_HOST_PRESSURE_JSON"
    return
  fi
  module_path="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/local-ci-host-pressure.mjs"
  node -e '
const { pathToFileURL } = require("node:url");
const modulePath = pathToFileURL(process.argv[1]).href;
const rootPath = process.argv[2];
import(modulePath).then(async ({ sampleLocalCiHostPressure }) => {
  const pressure = await sampleLocalCiHostPressure({
    rootPath,
    convergenceLockPaths: [],
    fencePaths: [],
    // Contributor preview produces no local-CI evidence artifact; isolation is
    // vacuously healthy while the registry activeKey remains the process fence.
    evidenceIsolationHealthy: true,
  });
  process.stdout.write(JSON.stringify(pressure));
}).catch((error) => {
  process.stderr.write(`host pressure sampling failed: ${error.message}\n`);
  process.exit(1);
});
' "$module_path" "$WORKTREE_PATH"
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
case "$MAX_TERMINAL_CLAIM_ATTEMPTS" in
  ''|*[!0-9]*) die "DPF_DEV_PORTAL_MAX_TERMINAL_CLAIM_ATTEMPTS must be a non-negative integer" ;;
esac

[ -n "$OWNER_SESSION_ID" ] || OWNER_SESSION_ID="dev-portal-$$"

release_lease() {
  lease_id_to_release="$1"
  release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id_to_release")}" | extract_tool_result)"
  release_success="$(printf '%s' "$release_response" | field success)"
  [ "$release_success" = "true" ] || return 1
  printf 'released %s\n' "$lease_id_to_release"
}

claim_lease() {
  [ -n "$WORKTREE_PATH" ] || die "DPF_DEV_WORKTREE (or --worktree) must be set so the lease records which worktree :3001 is bound to"
  if [ -z "$BRANCH" ]; then
    BRANCH="$("$GIT_BIN" -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null)" \
      || die "could not resolve the branch for contributor-preview worktree $WORKTREE_PATH"
    [ -n "$BRANCH" ] || die "resolved an empty branch for contributor-preview worktree $WORKTREE_PATH"
  fi
  expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 60000).toISOString())' "$EXPIRES_MINUTES")"
  # BI-D45898C0: the claim key identifies the RESOURCE, not the claimant.
  #
  # It used to be "dev-portal:${OWNER_SESSION_ID}:${BRANCH}", and
  # OWNER_SESSION_ID defaults to dev-portal-$$ — the shell PID. Every
  # invocation therefore minted a DIFFERENT key for the same worktree and
  # branch, so the queue could never recognise a re-claim as the same claim. A
  # supervisor restarting this script enqueued an unbounded set of distinct
  # claims for one preview: 2026-08-23 saw ~35 waiting, arriving every ~31s,
  # starving three unrelated pre-PR gates behind them (165 arrivals against 11
  # admissions, 19m median wait).
  #
  # Keyed on (worktree, branch) a re-claim is idempotent: the caller re-enters
  # its own claim instead of joining the back of the queue. Ownership still
  # travels separately as ownerSessionId, which is where claimant identity
  # belongs.
  base_claim_key="dev-portal:${WORKTREE_PATH}:${BRANCH}"
  claim_key="$base_claim_key"
  terminal_claim_attempt_sequence=0
  while :; do
    host_pressure_json="$(sample_host_pressure)" \
      || die "could not measure host pressure for governed preview admission"
    claim_args="$(node -e '
const args = {
  environmentKey: process.argv[1],
  ownerProvider: process.argv[2],
  ownerSessionId: process.argv[3],
  claimKey: process.argv[9],
  purpose: `Contributor preview (:3001) bound to ${process.argv[4]} @ ${process.argv[5]}`,
  url: process.argv[6],
  ports: JSON.parse(process.argv[7]),
  expiresAt: process.argv[8],
  worktreePath: process.argv[4],
  branchName: process.argv[5],
  cleanupCommand: "docker compose -p dpf --profile dev rm -sf dev-portal",
  hostPressure: JSON.parse(process.argv[10]),
};
process.stdout.write(JSON.stringify(args));
' "$ENVIRONMENT_KEY" "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$WORKTREE_PATH" "$BRANCH" "$URL" "$(json_array_numbers "$PORTS")" "$expires_at" "$claim_key" "$host_pressure_json")"
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
        capacity_reason="$(printf '%s' "$claim_response" | field data.poolPolicy.rollbackReason)"
        printf '%s\n' "WAITING lease ${CLAIMED_LEASE_ID} is queued at position ${queue_position:-unknown}; :3001 is not owned yet." >&2
        if [ -n "$capacity_reason" ]; then
          printf '%s\n' "Host-capacity admission reason: $capacity_reason." >&2
        fi
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
    terminal_reason="$(printf '%s' "$claim_response" | field data.reason)"
    [ -n "$terminal_reason" ] \
      || terminal_reason="$(printf '%s' "$claim_response" | field data.lease.status)"
    if [ "$claim_error" = "lease_terminal" ]; then
      case "$terminal_reason" in
        released|cancelled|expired)
          if [ "$terminal_claim_attempt_sequence" -ge "$MAX_TERMINAL_CLAIM_ATTEMPTS" ]; then
            die "terminal claim retry budget exhausted after ${terminal_claim_attempt_sequence} replacement attempt(s); last claim was ${terminal_reason}"
          fi
          terminal_claim_attempt_sequence=$((terminal_claim_attempt_sequence + 1))
          claim_key="${base_claim_key}:rerun-${terminal_claim_attempt_sequence}"
          printf '%s\n' "previous contributor-preview claim was ${terminal_reason}; creating terminal attempt ${terminal_claim_attempt_sequence}..."
          continue
          ;;
      esac
    fi
    die "failed to claim ${ENVIRONMENT_KEY} lease for :3001: $claim_response"
  done
}

renew_lease() {
  host_pressure_json="$(sample_host_pressure)" || return 1
  renew_args="$(node -e '
const args = {
  leaseId: process.argv[1],
  ownerSessionId: process.argv[2],
  ttlMinutes: Number(process.argv[3]),
  hostPressure: JSON.parse(process.argv[4]),
};
process.stdout.write(JSON.stringify(args));
' "$CLAIMED_LEASE_ID" "$OWNER_SESSION_ID" "$HEARTBEAT_TTL_MINUTES" "$host_pressure_json")"
  renew_response="$(mcp_call renew_nonprod_environment_lease "$renew_args" | extract_tool_result)" \
    || return 1
  [ "$(printf '%s' "$renew_response" | field success)" = "true" ] || return 1
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
    heartbeat_pid=""
    heartbeat_failure_file="$(mktemp "${TMPDIR:-/tmp}/dpf-dev-portal-heartbeat.XXXXXX")"
    cleanup_refresh() {
      refresh_status="$?"
      trap - EXIT HUP INT TERM
      "$DOCKER_BIN" compose -p dpf --profile dev stop dev-portal >/dev/null 2>&1 || true
      if [ -n "$heartbeat_pid" ]; then
        kill "$heartbeat_pid" >/dev/null 2>&1 || true
        wait "$heartbeat_pid" >/dev/null 2>&1 || true
      fi
      if [ -n "${CLAIMED_LEASE_ID:-}" ]; then
        release_lease "$CLAIMED_LEASE_ID" >/dev/null 2>&1 || true
      fi
      rm -f "$heartbeat_failure_file"
      exit "$refresh_status"
    }
    trap cleanup_refresh EXIT HUP INT TERM
    (
      while :; do
        sleep "$HEARTBEAT_SECONDS"
        if ! renew_lease; then
          printf '%s\n' "lease authority lost during Contributor preview" > "$heartbeat_failure_file"
          exit 1
        fi
      done
    ) &
    heartbeat_pid="$!"
    "$DOCKER_BIN" compose -p dpf --profile dev stop dev-portal
    "$DOCKER_BIN" compose -p dpf --profile dev up -d dev-portal
    if [ -s "$heartbeat_failure_file" ] || ! kill -0 "$heartbeat_pid" >/dev/null 2>&1; then
      printf '%s\n' "dev-portal-lease: lease authority lost before Contributor preview became ready" >&2
      exit 1
    fi
    printf '%s\n' "Contributor preview refreshed; lease heartbeat active as $CLAIMED_LEASE_ID."
    printf '%s\n' "Keep this process running during verification; stopping it stops :3001 and releases the lease."
    if [ "${NODE_ENV:-}" = "test" ] && [ "${DPF_DEV_PORTAL_TEST_EXIT_AFTER_READY:-}" = "1" ]; then
      kill "$heartbeat_pid" >/dev/null 2>&1 || true
      wait "$heartbeat_pid" >/dev/null 2>&1 || true
      heartbeat_pid=""
      release_lease "$CLAIMED_LEASE_ID" >/dev/null 2>&1 || true
      CLAIMED_LEASE_ID=""
      rm -f "$heartbeat_failure_file"
      trap - EXIT HUP INT TERM
      exit 0
    fi
    set +e
    wait "$heartbeat_pid"
    heartbeat_status="$?"
    set -e
    heartbeat_pid=""
    if [ "$heartbeat_status" -ne 0 ]; then
      printf '%s\n' "dev-portal-lease: $(cat "$heartbeat_failure_file")" >&2
      exit 1
    fi
    exit 0
    ;;
esac
