#!/bin/sh
set -eu

# dev-portal-lease.sh — lease-gate the :3001 Contributor preview.
#
# Per the accepted spec docs/superpowers/specs/2026-06-05-unified-delivery-
# surfaces-execution-alignment-design.md (§4.3 "Every shared singleton runtime
# MUST be lease-gated — including :3001" and §7 decision #5 "fold :3001 into the
# local-integration-ci lease"), the `dev-portal` container on :3001 is a single
# shared singleton using a sanitized disposable database. Its source mount and
# commit must match its admitted Workroom before any runtime mutation.
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
OWNER_PROVIDER="${DPF_DEV_PORTAL_OWNER_PROVIDER:-}"
OWNER_SESSION_ID="${DPF_DEV_PORTAL_OWNER_SESSION_ID:-${DPF_SESSION_REF:-${CODEX_THREAD_ID:-${CLAUDE_SESSION_ID:-${GROK_SESSION_ID:-}}}}}"
EXPIRES_MINUTES="${DPF_DEV_PORTAL_EXPIRES_MINUTES:-120}"
RESUME_LEASE_ID="${DPF_DEV_PORTAL_RESUME_LEASE_ID:-}"
TASK_RUN_ID="${DPF_DEV_PORTAL_TASK_RUN_ID:-}"
CLAIM_KEY="${DPF_DEV_PORTAL_CLAIM_KEY:-}"
URL="${DPF_DEV_PORTAL_URL:-http://localhost:3001}"
PORTS="${DPF_DEV_PORTAL_PORTS:-3001}"
WORKTREE_PATH="${DPF_DEV_WORKTREE:-}"
BRANCH=""
SOURCE_SHA=""
LEASE_ID="${DPF_DEV_PORTAL_LEASE_ID:-}"
GIT_BIN="${DPF_DEV_PORTAL_GIT_BIN:-git}"
DOCKER_BIN="${DPF_DEV_PORTAL_DOCKER_BIN:-docker}"
HEARTBEAT_SECONDS="${DPF_DEV_PORTAL_HEARTBEAT_SECONDS:-30}"
HEARTBEAT_TTL_MINUTES="${DPF_DEV_PORTAL_HEARTBEAT_TTL_MINUTES:-2}"
COMMAND=""

usage() {
  cat <<'EOF'
Usage: scripts/dev-portal-lease.sh <claim|refresh|status|release> [options]

Lease-gate the :3001 Contributor preview against the governed shared
local-integration-ci lease so it stops being an unleased shared singleton that
binds a verified worktree and uses a sanitized disposable database.

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
  --owner-provider NAME   Client provider (detected by canonical identity helper).
  --owner-session-id ID   Client thread (detected by canonical identity helper).
  --expires-minutes N     Lease expiry window (default: 120).
  --lease-id ID           Lease id to release (release only).
  --mcp-url URL           MCP endpoint (default: DPF_MCP_URL or local portal).
  --help                  Show this help.

Environment:
  MCP auth               Canonical bootstrap credential; no operator password entry.
  DPF_DEV_WORKTREE        Absolute worktree path (forward slashes).
  DPF_DEV_PORTAL_CLAIM_KEY Attempt identity; terminal attempts never auto-retry.
  DPF_DEV_PORTAL_RESUME_LEASE_ID / DPF_DEV_PORTAL_TASK_RUN_ID
                          Provided by the durable resume task, never a poll loop.
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
  module_base="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib"
  DPF_GATE_CURL_BIN="${DPF_DEV_PORTAL_CURL_BIN:-}" node --input-type=module -e '
const { pathToFileURL } = await import("node:url");
const [base, tool, serialized, mcpUrl] = process.argv.slice(1);
const { mcpCall } = await import(pathToFileURL(`${base}/mcp-client.mjs`).href);
const { resolveMcpCredential } = await import(pathToFileURL(`${base}/mcp-credential.mjs`).href);
try {
  const result = await mcpCall(tool, JSON.parse(serialized), {
    mcpUrl, bearerToken: resolveMcpCredential({ mcpUrl }).bearer,
  });
  process.stdout.write(JSON.stringify({ result: { structuredContent: result } }));
} catch { console.error("dev-portal-lease: canonical MCP credential or transport unavailable"); process.exitCode = 1; }
' "$module_base" "$tool_name" "$arguments_json" "$MCP_URL"
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


identity_module="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib/agent-identity.mjs"
identity="$(node --input-type=module -e '
const { pathToFileURL } = await import("node:url");
const { resolveAgentIdentity } = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(JSON.stringify(resolveAgentIdentity({ env: process.env,
  providerOverride: process.argv[2], sessionOverride: process.argv[3], pid: process.pid })));
' "$identity_module" "$OWNER_PROVIDER" "$OWNER_SESSION_ID")"
OWNER_PROVIDER="$(printf '%s' "$identity" | field provider)"
OWNER_SESSION_ID="$(printf '%s' "$identity" | field sessionId)"
case "$COMMAND" in
  claim|refresh) [ -n "$OWNER_PROVIDER" ] || die "canonical client provider could not be resolved" ;;
esac

release_lease() {
  lease_id_to_release="$1"
  release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id_to_release"),\"ownerSessionId\":$(json_escape "$OWNER_SESSION_ID")}" | extract_tool_result)"
  release_success="$(printf '%s' "$release_response" | field success)"
  if [ "$release_success" != "true" ]; then
    printf '%s\n' "Release action: lease $lease_id_to_release, owner session $OWNER_SESSION_ID; $release_response" >&2
    return 1
  fi
  printf 'released %s\n' "$lease_id_to_release"
}

claim_lease() {
  [ -n "$WORKTREE_PATH" ] || die "DPF_DEV_WORKTREE (or --worktree) must be set so the lease records which worktree :3001 is bound to"
  if [ -z "$BRANCH" ]; then
    BRANCH="$("$GIT_BIN" -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null)" \
      || die "could not resolve the branch for contributor-preview worktree $WORKTREE_PATH"
    [ -n "$BRANCH" ] || die "resolved an empty branch for contributor-preview worktree $WORKTREE_PATH"
  fi
  SOURCE_SHA="$("$GIT_BIN" -C "$WORKTREE_PATH" rev-parse HEAD)" || die "could not resolve preview source SHA"
  expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 60000).toISOString())' "$EXPIRES_MINUTES")"
  # BI-D45898C0: the claim key identifies the RESOURCE, not the claimant.
  #
  # It used to be "dev-portal:${OWNER_SESSION_ID}:${BRANCH}", and
  # OWNER_SESSION_ID formerly defaulted to a shell PID. Every
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
  claim_key="${CLAIM_KEY:-$base_claim_key}"
  while :; do
    host_pressure_json="$(sample_host_pressure)" \
      || die "could not measure host pressure for governed preview admission"
    claim_args="$(node -e '
const args = {
  environmentKey: process.argv[1],
  ownerProvider: process.argv[2],
  ownerSessionId: process.argv[3],
  claimKey: process.argv[9],
  purpose: `Contributor preview (:3001) bound to ${process.argv[4]} @ ${process.argv[5]} (${process.argv[13]})`,
  url: process.argv[6],
  ports: JSON.parse(process.argv[7]),
  expiresAt: process.argv[8],
  worktreePath: process.argv[4],
  branchName: process.argv[5],
  cleanupCommand: "docker compose -p dpf --profile dev rm -sf dev-portal",
  hostPressure: JSON.parse(process.argv[10]),
  ...(process.argv[11] ? {resumeLeaseId: process.argv[11]} : {}),
  ...(process.argv[12] ? {taskRunId: process.argv[12]} : {}),
};
process.stdout.write(JSON.stringify(args));
' "$ENVIRONMENT_KEY" "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$WORKTREE_PATH" "$BRANCH" "$URL" "$(json_array_numbers "$PORTS")" "$expires_at" "$claim_key" "$host_pressure_json" "$RESUME_LEASE_ID" "$TASK_RUN_ID" "$SOURCE_SHA")"
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
        task_run_id="$(printf '%s' "$claim_response" | field data.admission.taskRunId)"
        printf '%s\n' "Durable task ${task_run_id:-unavailable} resumes this wait; stop here without repeating the claim." >&2
        return 3
      fi
      [ "$admission_status" = "admitted" ] || die "claim did not prove admitted ownership"
      CLAIMED_EXPIRES_AT="$(printf '%s' "$claim_response" | field data.lease.expiresAt)"
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
    if [ "$claim_error" = "lease_terminal" ]; then
      die "terminal lease claim; stop. A new explicitly wanted attempt requires a new claim key."
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
    export DPF_DEV_WORKTREE="$WORKTREE_PATH"
    export DPF_DEV_PORTAL_SOURCE_SHA="$SOURCE_SHA"
    export DPF_DEV_PORTAL_OWNER_SESSION_ID="$OWNER_SESSION_ID"
    export DPF_DEV_PORTAL_LEASE_ID="$CLAIMED_LEASE_ID"
    export DPF_DEV_PORTAL_LEASE_EXPIRES_AT="$CLAIMED_EXPIRES_AT"
    export DPF_MCP_URL="$MCP_URL"
    node "$(dirname -- "$0")/lib/dev-preview-runtime.mjs"
    exit "$?"
    ;;
esac
