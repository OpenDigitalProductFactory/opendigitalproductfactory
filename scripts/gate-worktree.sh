#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MCP_URL="${DPF_MCP_URL:-http://127.0.0.1:3000/api/mcp/v1}"
REMOTE="origin"
BRANCH=""
SHA=""
WORKTREE_PATH=""
OWNER_PROVIDER="${DPF_GATE_OWNER_PROVIDER:-codex}"
OWNER_SESSION_ID="${DPF_GATE_OWNER_SESSION_ID:-}"
LEASE_WAIT_SECONDS="${DPF_GATE_LEASE_WAIT_SECONDS:-300}"
POLL_SECONDS="${DPF_GATE_POLL_SECONDS:-10}"
EXPIRES_MINUTES="${DPF_GATE_EXPIRES_MINUTES:-60}"
PUSH_BRANCH=0
DRY_RUN=0
FINALIZE_EVIDENCE=0
LOCAL_CI_COMMAND="${DPF_LOCAL_CI_COMMAND:-}"
ALLOW_STUB="${DPF_ALLOW_LOCAL_CI_STUB:-0}"
URL="${DPF_LOCAL_CI_URL:-http://localhost:3010}"
PORTS="3010"
GIT_BIN="${DPF_GATE_GIT_BIN:-git}"
CURL_BIN="${DPF_GATE_CURL_BIN:-curl}"
STATE_FILE=""
gate_pid=""
heartbeat_pid=""
lease_id=""
lease_released=0
lease_events_file=""
lease_fence_file=""
local_fence_file=""
local_fence_token=""
METADATA_FILE=""
PENDING_EVIDENCE_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/gate-worktree.sh [options]

Options:
  --branch NAME              Branch to gate (default: current branch)
  --sha SHA                  Commit SHA to gate (default: HEAD)
  --worktree PATH            Worktree path (default: git rev-parse --show-toplevel)
  --remote NAME              Remote used only with --push (default: origin)
  --owner-provider NAME      build-studio|claude|codex|coworker (default: codex)
  --owner-session-id ID      External session id (default: gate-<pid>)
  --mcp-url URL              MCP endpoint (default: DPF_MCP_URL or local portal)
  --lease-wait-seconds N     Max time to wait when the lease is busy (default: 300)
  --poll-seconds N           Busy-lease poll interval (default: 10)
  --expires-minutes N        Lease expiry window (default: 60)
  --push                     Push before claiming the lease (legacy/explicit publication mode)
  --no-push                  Do not push before claiming the lease (default)
  --dry-run                  Print planned actions; skip git push and MCP calls
  --finalize-evidence        Publish a pending local-CI evidence record without rerunning the gate
  --help                     Show this help

Environment:
  DPF_LOCAL_CI_COMMAND        Command to run while holding the local-CI lease.
                              Default: scripts/local-ci-runner.sh --candidate <branch>
                              (the checked-in non-mutating merge-workspace runner).
  DPF_ALLOW_LOCAL_CI_STUB=1   Test-only escape hatch for the Phase 1 stub.
EOF
}

die() {
  printf '%s\n' "gate-worktree: $*" >&2
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

terminate_process_tree() {
  target_pid="${1:-}"
  [ -n "$target_pid" ] || return 0
  if command -v pgrep >/dev/null 2>&1; then
    for child_pid in $(pgrep -P "$target_pid" 2>/dev/null || true); do
      terminate_process_tree "$child_pid"
    done
  fi
  kill -TERM "$target_pid" 2>/dev/null || true
}

stop_heartbeat() {
  if [ -n "$heartbeat_pid" ]; then
    kill "$heartbeat_pid" 2>/dev/null || true
    wait "$heartbeat_pid" 2>/dev/null || true
    heartbeat_pid=""
  fi
}

cleanup_gate() {
  stop_heartbeat
  if [ -n "$gate_pid" ]; then
    terminate_process_tree "$gate_pid"
    gate_pid=""
  fi
  if [ -n "$lease_id" ] && [ "$lease_released" != "1" ]; then
    mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" >/dev/null 2>&1 || true
    lease_released=1
  fi
  if [ -n "$local_fence_token" ]; then
    node "$SCRIPT_DIR/lib/local-sandbox-fence.mjs" release "$local_fence_file" "$local_fence_token" >/dev/null 2>&1 || true
    local_fence_token=""
  fi
  [ -z "$lease_events_file" ] || rm -f "$lease_events_file"
  [ -z "$lease_fence_file" ] || rm -f "$lease_fence_file"
}

write_state() {
  gate_passed="$1"
  lease_id="$2"
  evidence_id="$3"
  status="$4"
  expires_at_value="$5"
  resilience_json="${6:-null}"
  lease_events_json="${7:-[]}"
  evidence_pending="${8:-false}"
  pending_reason="${9:-}"
  mkdir -p "$(dirname "$STATE_FILE")"
  node -e '
const fs = require("node:fs");
const resilience = JSON.parse(process.argv[9]);
const leaseEvents = JSON.parse(process.argv[10]);
const out = process.argv[1];
const payload = {
  branch: process.argv[2],
  sha: process.argv[3],
  gatePassed: process.argv[4] === "true",
  leaseId: process.argv[5],
  evidenceRecordId: process.argv[6],
  status: process.argv[7],
  expiresAt: process.argv[8],
  leaseEvents,
  recordedAt: new Date().toISOString()
};
if (resilience) payload.resilience = resilience;
payload.evidencePending = process.argv[11] === "true";
if (payload.evidencePending) payload.evidencePendingReason = process.argv[12] || "unknown";
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
' "$STATE_FILE" "$BRANCH" "$SHA" "$gate_passed" "$lease_id" "$evidence_id" "$status" "$expires_at_value" "$resilience_json" "$lease_events_json" "$evidence_pending" "$pending_reason"
}

preflight_quiescence() {
  response="$(mcp_call get_quiescence_status "{}" 2>/dev/null | extract_tool_result 2>/dev/null || true)"
  [ -n "$response" ] || return 0
  success="$(printf '%s' "$response" | field success)"
  [ "$success" = "true" ] || return 0
  level="$(printf '%s' "$response" | field data.level)"
  writes_refused="$(printf '%s' "$response" | field data.writesRefused)"
  retry_after="$(printf '%s' "$response" | field data.retryAfterSeconds)"
  [ -n "$retry_after" ] || retry_after=30
  if [ "$level" != "" ] && [ "$level" != "normal" ]; then
    write_state false "" "" "blocked_quiescence" "$expires_at" "null" "[]" false ""
    printf '%s\n' "gate-worktree: portal is ${level}; local-CI evidence writes are currently refused. Retry after ${retry_after}s." >&2
    printf '%s\n' "gate-worktree: no expensive local-CI command was run; call get_quiescence_status for drain blockers." >&2
    exit 4
  fi
  if [ "$writes_refused" = "true" ]; then
    write_state false "" "" "blocked_quiescence" "$expires_at" "null" "[]" false ""
    printf '%s\n' "gate-worktree: portal quiescence status reports writesRefused=true. Retry after ${retry_after}s." >&2
    exit 4
  fi
}

preflight_leases() {
  response="$(mcp_call list_nonprod_environment_leases "{}" 2>/dev/null | extract_tool_result 2>/dev/null || true)"
  [ -n "$response" ] || return 0
  printf '%s' "$response" | node -e '
const fs = require("node:fs");
let payload;
try { payload = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }
const leases = payload?.data?.leases || payload?.leases || [];
const active = Array.isArray(leases)
  ? leases.filter((l) => (l.environmentKey || l.environment || l.key) === "local-integration-ci")
  : [];
if (active.length > 0) {
  console.error(`gate-worktree: preflight sees ${active.length} active local-integration-ci lease(s); claim will queue if busy.`);
}
' || true
}

preflight_main_freshness() {
  if "$GIT_BIN" rev-parse --verify origin/main >/dev/null 2>&1; then
    behind="$("$GIT_BIN" rev-list --count HEAD..origin/main 2>/dev/null || printf '0')"
    if [ "$behind" != "0" ]; then
      printf '%s\n' "gate-worktree: preflight warning: HEAD is ${behind} commit(s) behind origin/main; local-ci-runner will merge the current base before expensive gates." >&2
    fi
  fi
}

write_pending_evidence() {
  reason="$1"
  retry_after="$2"
  mkdir -p "$(dirname "$PENDING_EVIDENCE_FILE")"
  node -e '
const fs = require("node:fs");
const out = process.argv[1];
const recordArgs = JSON.parse(process.argv[2]);
const payload = {
  schema: "dpf-local-ci-pending-evidence/v1",
  branch: process.argv[3],
  sha: process.argv[4],
  expiresAt: process.argv[5],
  reason: process.argv[6],
  retryAfterSeconds: Number(process.argv[7] || 30),
  recordedAt: new Date().toISOString(),
  recordArgs
};
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
' "$PENDING_EVIDENCE_FILE" "$evidence_args" "$BRANCH" "$SHA" "$expires_at" "$reason" "$retry_after"
}

finalize_pending_evidence() {
  [ -f "$PENDING_EVIDENCE_FILE" ] || die "no pending local-CI evidence file found at $PENDING_EVIDENCE_FILE"
  preflight_quiescence
  pending_json="$(cat "$PENDING_EVIDENCE_FILE")"
  pending_branch="$(printf '%s' "$pending_json" | field branch)"
  pending_sha="$(printf '%s' "$pending_json" | field sha)"
  [ "$pending_branch" = "$BRANCH" ] || die "pending evidence branch mismatch: $pending_branch != $BRANCH"
  [ "$pending_sha" = "$SHA" ] || die "pending evidence sha mismatch: $pending_sha != $SHA"
  record_args="$(printf '%s' "$pending_json" | node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(payload.recordArgs));
')"
  evidence_response="$(mcp_call record_local_integration_result "$record_args" | extract_tool_result)"
  evidence_success="$(printf '%s' "$evidence_response" | field success)"
  if [ "$evidence_success" != "true" ]; then
    die "failed to record pending local-CI evidence: $evidence_response"
  fi
  evidence_id="$(printf '%s' "$evidence_response" | field entityId)"
  pending_expires_at="$(printf '%s' "$pending_json" | field expiresAt)"
  [ -n "$pending_expires_at" ] || pending_expires_at="$expires_at"
  write_state true "" "$evidence_id" "passed" "$pending_expires_at" "null" "[]" false ""
  rm -f "$PENDING_EVIDENCE_FILE"
  printf '%s\n' "recorded pending local-CI evidence: $evidence_id"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    --worktree) WORKTREE_PATH="${2:-}"; shift 2 ;;
    --remote) REMOTE="${2:-}"; shift 2 ;;
    --owner-provider) OWNER_PROVIDER="${2:-}"; shift 2 ;;
    --owner-session-id) OWNER_SESSION_ID="${2:-}"; shift 2 ;;
    --mcp-url) MCP_URL="${2:-}"; shift 2 ;;
    --lease-wait-seconds) LEASE_WAIT_SECONDS="${2:-}"; shift 2 ;;
    --poll-seconds) POLL_SECONDS="${2:-}"; shift 2 ;;
    --expires-minutes) EXPIRES_MINUTES="${2:-}"; shift 2 ;;
    --push) PUSH_BRANCH=1; shift ;;
    --no-push) PUSH_BRANCH=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --finalize-evidence) FINALIZE_EVIDENCE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    --) shift ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$BRANCH" ] || BRANCH="$("$GIT_BIN" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "cannot gate detached HEAD"
[ -n "$SHA" ] || SHA="$("$GIT_BIN" rev-parse HEAD)"
[ -n "$WORKTREE_PATH" ] || WORKTREE_PATH="$("$GIT_BIN" rev-parse --show-toplevel)"
[ -n "$OWNER_SESSION_ID" ] || OWNER_SESSION_ID="gate-$$"
STATE_FILE="$("$GIT_BIN" rev-parse --git-path dpf-local-ci-gate.json)"
METADATA_FILE="$("$GIT_BIN" rev-parse --git-path dpf-local-ci-metadata.json)"
git_common_dir="$("$GIT_BIN" rev-parse --git-common-dir)"
local_fence_file="${DPF_LOCAL_SANDBOX_FENCE_PATH:-$(node -e 'const p=require("node:path"); process.stdout.write(p.resolve(process.argv[1], process.argv[2], "dpf-local-ci-owner.json"))' "$WORKTREE_PATH" "$git_common_dir")}"
PENDING_EVIDENCE_FILE="$("$GIT_BIN" rev-parse --git-path dpf-local-ci-pending-evidence.json)"

# Checked-in default (BI-157DC9B2): when no DPF_LOCAL_CI_COMMAND is supplied and
# the stub is not explicitly allowed, run the non-mutating merge-workspace
# runner. Agents get a working `pnpm run pregate` with zero configuration.
if [ -z "$LOCAL_CI_COMMAND" ] && [ "$ALLOW_STUB" != "1" ] && [ -f "$SCRIPT_DIR/local-ci-runner.sh" ]; then
  LOCAL_CI_COMMAND="sh '$SCRIPT_DIR/local-ci-runner.sh' --candidate '$BRANCH'"
fi

if [ "$DRY_RUN" = "1" ]; then
  printf 'gate-worktree dry-run\n'
  printf 'branch=%s\nsha=%s\nworktree=%s\nremote=%s\nmcpUrl=%s\n' "$BRANCH" "$SHA" "$WORKTREE_PATH" "$REMOTE" "$MCP_URL"
  printf 'metadataFile=%s\n' "$METADATA_FILE"
  printf 'pendingEvidenceFile=%s\n' "$PENDING_EVIDENCE_FILE"
  if [ "$PUSH_BRANCH" = "1" ]; then
    printf 'pushBeforeLease=true\n'
  else
    printf 'pushBeforeLease=false\n'
  fi
  if [ -n "$LOCAL_CI_COMMAND" ]; then
    printf 'localCiCommand=%s\n' "$LOCAL_CI_COMMAND"
  elif [ "$ALLOW_STUB" = "1" ]; then
    printf 'localCiCommand=sandbox checkout/build stub (explicitly allowed)\n'
  else
    printf 'localCiCommand=missing; gate would fail before push/lease\n'
  fi
  printf 'would call claim_nonprod_environment_lease and record_local_integration_result only when a real command or explicit stub is configured\n'
  exit 0
fi

[ -n "${DPF_MCP_BEARER_TOKEN:-}" ] || die "DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease"

expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 60000).toISOString())' "$EXPIRES_MINUTES")"

if [ "$FINALIZE_EVIDENCE" = "1" ]; then
  finalize_pending_evidence
  exit 0
fi

[ -n "$LOCAL_CI_COMMAND" ] || [ "$ALLOW_STUB" = "1" ] || die "local-CI gate runner is not wired (scripts/local-ci-runner.sh is missing); refusing to record passing stub evidence. Set DPF_LOCAL_CI_COMMAND to the canonical sandbox command, or use DPF_ALLOW_LOCAL_CI_STUB=1 only in contract tests."

preflight_quiescence
preflight_leases
preflight_main_freshness

if [ "$PUSH_BRANCH" = "1" ]; then
  # DPF_PREPUSH_GATE_INFLIGHT: this push is part of the gate run itself — the
  # chained pre-push-gate must not demand the record we are about to produce.
  DPF_PREPUSH_GATE_INFLIGHT=1 "$GIT_BIN" push "$REMOTE" "$BRANCH"
fi

lease_ttl_ms="$(node -e 'process.stdout.write(String(Math.min(Number(process.argv[1]) * 60000, 20 * 60000)))' "$EXPIRES_MINUTES")"
expires_at=""
deadline="$(node -e 'process.stdout.write(String(Date.now() + Number(process.argv[1]) * 1000))' "$LEASE_WAIT_SECONDS")"
lease_id=""

while :; do
  # The helper records its native parent PID. On Git-for-Windows, `$$` is an
  # MSYS identity and is not guaranteed to be a native PID that Node can probe.
  local_fence_response="$(node "$SCRIPT_DIR/lib/local-sandbox-fence.mjs" acquire "$local_fence_file" "$OWNER_SESSION_ID" "$BRANCH")"
  local_fence_status="$(printf '%s' "$local_fence_response" | field status)"
  if [ "$local_fence_status" = "conflict" ]; then
    now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
    [ "$now_ms" -lt "$deadline" ] || die "local-CI sandbox owner process is still live; timed out waiting"
    printf '%s\n' "local-CI sandbox process fence is held; retrying in ${POLL_SECONDS}s..."
    sleep "$POLL_SECONDS"
    continue
  fi
  local_fence_token="$(printf '%s' "$local_fence_response" | field record.token)"
  expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString())' "$lease_ttl_ms")"
  claim_args="$(node -e '
const args = {
  environmentKey: "local-integration-ci",
  ownerProvider: process.argv[1],
  ownerSessionId: process.argv[2],
  purpose: `Pre-PR local-CI gate for ${process.argv[3]} @ ${process.argv[4]}`,
  url: process.argv[5],
  ports: JSON.parse(process.argv[6]),
  expiresAt: process.argv[7],
  worktreePath: process.argv[8],
  branchName: process.argv[3],
  cleanupCommand: "docker compose -f docker-compose.local-ci.yml --profile local-ci down"
};
process.stdout.write(JSON.stringify(args));
' "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$BRANCH" "$SHA" "$URL" "$(json_array_numbers "$PORTS")" "$expires_at" "$WORKTREE_PATH")"
  claim_response="$(mcp_call claim_nonprod_environment_lease "$claim_args" | extract_tool_result)"
  claim_success="$(printf '%s' "$claim_response" | field success)"
  claim_error="$(printf '%s' "$claim_response" | field error)"
  if [ "$claim_success" = "true" ]; then
    lease_id="$(printf '%s' "$claim_response" | field entityId)"
    [ -n "$lease_id" ] || lease_id="$(printf '%s' "$claim_response" | field data.lease.leaseId)"
    break
  fi
  node "$SCRIPT_DIR/lib/local-sandbox-fence.mjs" release "$local_fence_file" "$local_fence_token" >/dev/null
  local_fence_token=""
  if [ "$claim_error" = "lease_conflict" ]; then
    now_ms="$(node -e 'process.stdout.write(String(Date.now()))')"
    [ "$now_ms" -lt "$deadline" ] || die "local-CI sandbox lease is busy; timed out waiting"
    printf '%s\n' "local-CI sandbox busy; queued behind active lease. Retrying in ${POLL_SECONDS}s..."
    sleep "$POLL_SECONDS"
  else
    die "failed to claim local-CI lease: $claim_response"
  fi
done

gate_passed=false
evidence_id=""
status="failed"
gate_command_label=""
gate_output_file="$(mktemp)"
lease_events_file="$(mktemp)"
lease_fence_file="$(mktemp)"
gate_output=""
heartbeat_interval="$(node -e 'process.stdout.write(String(Math.max(1, Math.floor(Number(process.argv[1]) / 3000))))' "$lease_ttl_ms")"
printf '{"type":"claimed","at":%s,"expiresAt":%s}\n' "$(json_escape "$(node -e 'process.stdout.write(new Date().toISOString())')")" "$(json_escape "$expires_at")" >>"$lease_events_file"
trap cleanup_gate EXIT
trap 'terminate_process_tree "$gate_pid"' INT TERM

set +e
printf '%s\n' "local-CI sandbox lease claimed: $lease_id"
if [ -n "$LOCAL_CI_COMMAND" ]; then
  gate_command_label="$LOCAL_CI_COMMAND"
  printf '%s\n' "running local-CI command: $LOCAL_CI_COMMAND"
  DPF_LOCAL_CI_METADATA_FILE="$METADATA_FILE" DPF_NONPROD_LEASE_ID="$lease_id" DPF_NONPROD_OWNER_SESSION_ID="$OWNER_SESSION_ID" sh -c "$LOCAL_CI_COMMAND" >"$gate_output_file" 2>&1 &
  gate_pid=$!
  (
    while sleep "$heartbeat_interval"; do
      local_heartbeat="$(node "$SCRIPT_DIR/lib/local-sandbox-fence.mjs" heartbeat "$local_fence_file" "$local_fence_token" 2>/dev/null || true)"
      if [ "$(printf '%s' "$local_heartbeat" | field status 2>/dev/null || true)" != "renewed" ]; then
        printf '%s\n' "local-process-fence-lost" >"$lease_fence_file"
        printf '{"type":"heartbeat-lost","at":%s,"reason":"local-process-fence-lost"}\n' "$(json_escape "$(node -e 'process.stdout.write(new Date().toISOString())')")" >>"$lease_events_file"
        terminate_process_tree "$gate_pid"
        exit 1
      fi
      renew_args="{\"leaseId\":$(json_escape "$lease_id"),\"ownerSessionId\":$(json_escape "$OWNER_SESSION_ID")}"
      renew_response="$(mcp_call renew_nonprod_environment_lease "$renew_args" | extract_tool_result 2>/dev/null || true)"
      if [ "$(printf '%s' "$renew_response" | field success 2>/dev/null || true)" != "true" ]; then
        printf '%s\n' "lease-renewal-failed" >"$lease_fence_file"
        printf '{"type":"heartbeat-lost","at":%s}\n' "$(json_escape "$(node -e 'process.stdout.write(new Date().toISOString())')")" >>"$lease_events_file"
        terminate_process_tree "$gate_pid"
        exit 1
      fi
      printf '{"type":"heartbeat-renewed","at":%s}\n' "$(json_escape "$(node -e 'process.stdout.write(new Date().toISOString())')")" >>"$lease_events_file"
    done
  ) &
  heartbeat_pid=$!
  wait "$gate_pid"
  gate_status=$?
  gate_pid=""
  stop_heartbeat
  if [ -s "$lease_fence_file" ]; then
    gate_status=75
    printf '%s\n' "gate-worktree: lease fenced; child process tree terminated" >>"$gate_output_file"
  fi
else
  gate_command_label="sandbox checkout/build stub"
  printf '%s\n' "sandbox checkout/build stub: gate passed (explicit test-only mode)"
  printf '%s\n' "sandbox checkout/build stub: gate passed (DPF_ALLOW_LOCAL_CI_STUB=1)" >"$gate_output_file"
  gate_status=0
fi
set -e

# Release as soon as the mutation window ends — parity with gate-worktree.mjs
# superviseLeaseRun finally (claim -> release -> record). Holding the lease only
# for the sandbox command is intentional (BI-52500C0D); evidence recording does
# not need the shared lease.
if [ -n "$lease_id" ] && [ "$lease_released" != "1" ]; then
  release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" | extract_tool_result)"
  release_success="$(printf '%s' "$release_response" | field success)"
  [ "$release_success" = "true" ] || die "failed to release local-CI lease: $release_response"
  lease_released=1
  printf '{"type":"released","at":%s}\n' "$(json_escape "$(node -e 'process.stdout.write(new Date().toISOString())')")" >>"$lease_events_file"
fi
if [ -n "$local_fence_token" ]; then
  node "$SCRIPT_DIR/lib/local-sandbox-fence.mjs" release "$local_fence_file" "$local_fence_token" >/dev/null
  local_fence_token=""
fi

lease_events_json="$(node -e '
const fs = require("node:fs");
const rows = fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
process.stdout.write(JSON.stringify(rows));
' "$lease_events_file")"

cat "$gate_output_file"
gate_output="$(tail -c 12000 "$gate_output_file" 2>/dev/null || cat "$gate_output_file")"
failure_summary_json="$(node "$SCRIPT_DIR/lib/local-ci-failure-summary.mjs" "$gate_output_file" 2>/dev/null || printf '%s' '{"schema":"dpf-local-ci-failure-summary/v1","failedTests":[],"failedChecks":[],"omittedFailureLineCount":0,"truncated":false}')"
rm -f "$gate_output_file"

# Sandbox freshness classification (BI-ECDF9520): the preflight (run inside the
# gate command) writes a report next to the git dir. A red/missing-freshness
# sandbox must surface as blocked_sandbox_drift — never as product build
# evidence — and exit codes 3/4 from the preflight are reserved for that.
freshness_report_file="$("$GIT_BIN" rev-parse --git-path dpf-sandbox-freshness.json 2>/dev/null || true)"
outcome_json="$(node -e '
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const reportPath = process.argv[1];
const gateExitCode = Number(process.argv[2]);
const libPath = process.argv[3];
let report = null;
try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); } catch {}
import(pathToFileURL(libPath).href).then(({ classifyGateOutcome }) => {
  const outcome = classifyGateOutcome({
    freshnessVerdict: report ? report.verdict : "",
    gateExitCode,
  });
  const freshness = report
    ? {
        verdict: report.verdict,
        failures: report.failures,
        packages: (report.packages || []).map((p) => ({ name: p.name, locked: p.lockedVersion, resolved: p.resolvedVersion })),
        convergence: report.convergence,
        generatedAt: report.generatedAt,
      }
    : { verdict: "unknown", reason: "no freshness report was produced by the gate command" };
  process.stdout.write(JSON.stringify({ ...outcome, freshness }));
});
' "$freshness_report_file" "$gate_status" "$SCRIPT_DIR/lib/sandbox-freshness.mjs")"
status="$(printf '%s' "$outcome_json" | field status)"
gate_passed="$(printf '%s' "$outcome_json" | field gatePassed)"
gate_summary="$(printf '%s' "$outcome_json" | field summary)"

resilience_json="$(node -e '
const fs = require("node:fs");
const pushBeforeLease = process.argv[1] === "1";
let contentMetadata = null;
try { contentMetadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch {}
const fetchBase = contentMetadata && contentMetadata.fetchBase === true;
process.stdout.write(JSON.stringify({
  publicationMode: pushBeforeLease ? "push-before-lease" : "deferred",
  acceptedBaseMode: fetchBase ? "fetch-base" : "local-ref",
  networkTolerance: (!pushBeforeLease && !fetchBase) ? "offline-capable" : "network-required"
}));
' "$PUSH_BRANCH" "$METADATA_FILE")"

evidence_args="$(node -e '
const fs = require("node:fs");
const outcome = JSON.parse(process.argv[11]);
const resilience = JSON.parse(process.argv[16]);
const leaseEvents = JSON.parse(process.argv[17]);
const failureSummary = JSON.parse(process.argv[18]);
let contentMetadata = null;
try { contentMetadata = JSON.parse(fs.readFileSync(process.argv[14], "utf8")); } catch {}
const evidence = {
  bi: "BI-166C59F3",
  resilienceBi: "BI-76551B2D",
  freshnessBi: "BI-ECDF9520",
  impactedTestRecommendationBi: "BI-A4EC0EA6",
  phase: 1,
  leaseId: process.argv[3],
  leaseEvents,
  leaseSupervisionStatus: Number(process.argv[12]) === 75 ? "fenced" : "completed",
  branch: process.argv[4],
  sha: process.argv[5],
  expiresAt: process.argv[15],
  pushBeforeLease: process.argv[13] === "1",
  resilience,
  content: contentMetadata,
  gatePassed: outcome.gatePassed,
  freshness: outcome.freshness,
  impactedTests: {
    recommendationBacklogItem: "BI-A4EC0EA6",
    status: "deferred_to_code_graph_recommender",
    note: "Local-CI records the handoff; graph-backed impacted-test selection remains owned by BI-A4EC0EA6."
  },
  commands: [process.argv[7]],
  buildCommand: process.argv[7],
  buildExitCode: Number(process.argv[12]),
  output: process.argv[8],
  failureSummary,
  url: process.argv[6]
};
process.stdout.write(JSON.stringify({
  provider: process.argv[9],
  externalSessionId: process.argv[10],
  routeContext: "/build",
  candidateBranch: process.argv[4],
  mode: "single-branch",
  status: outcome.status,
  summary: outcome.summary,
  evidence,
  failureSummary
}));
' "$status" "$gate_passed" "$lease_id" "$BRANCH" "$SHA" "$URL" "$gate_command_label" "$gate_output" "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$outcome_json" "$gate_status" "$PUSH_BRANCH" "$METADATA_FILE" "$expires_at" "$resilience_json" "$lease_events_json" "$failure_summary_json")"
evidence_response="$(mcp_call record_local_integration_result "$evidence_args" | extract_tool_result)"
evidence_success="$(printf '%s' "$evidence_response" | field success)"
if [ "$evidence_success" != "true" ] && [ "$status" = "blocked_sandbox_drift" ]; then
  evidence_error="$(printf '%s' "$evidence_response" | field error)"
  if [ "$evidence_error" = "invalid_status" ]; then
    # Portal predates blocked_sandbox_drift (BI-ECDF9520). Downgrade the status
    # field only — the summary and evidence.freshness still say sandbox drift,
    # so the record cannot be misread as product build evidence.
    printf '%s\n' "gate-worktree: portal does not know blocked_sandbox_drift yet; recording as failed with sandbox-drift evidence"
    evidence_args="$(printf '%s' "$evidence_args" | node -e '
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
payload.status = "failed";
payload.summary = `[SANDBOX_DRIFT — not product evidence] ${payload.summary}`;
process.stdout.write(JSON.stringify(payload));
')"
    evidence_response="$(mcp_call record_local_integration_result "$evidence_args" | extract_tool_result)"
    evidence_success="$(printf '%s' "$evidence_response" | field success)"
  fi
fi
if [ "$evidence_success" = "true" ]; then
  evidence_id="$(printf '%s' "$evidence_response" | field entityId)"
else
  evidence_error="$(printf '%s' "$evidence_response" | field error)"
  [ -n "$evidence_error" ] || evidence_error="$(printf '%s' "$evidence_response" | field data.error)"
  if [ "$gate_passed" = "true" ] && [ "$evidence_error" = "portal_quiescing" ]; then
    retry_after="$(printf '%s' "$evidence_response" | field data.retryAfterSeconds)"
    [ -n "$retry_after" ] || retry_after="$(printf '%s' "$evidence_response" | field retryAfterSeconds)"
    [ -n "$retry_after" ] || retry_after=30
    write_pending_evidence "$evidence_error" "$retry_after"
    write_state true "$lease_id" "" "$status" "$expires_at" "$resilience_json" "$lease_events_json" true "$evidence_error"
    printf '%s\n' "gate-worktree: local-CI gate passed but evidence recording is pending because the portal is quiescing." >&2
    printf '%s\n' "gate-worktree: the lease is released; rerun scripts/gate-worktree.sh --finalize-evidence --branch '$BRANCH' --sha '$SHA' --worktree '$WORKTREE_PATH' after quiescence clears." >&2
    exit 4
  fi
  write_state false "$lease_id" "" "failed" "$expires_at" "$resilience_json" "$lease_events_json" false ""
  die "failed to record local integration evidence: $evidence_response"
fi

write_state "$gate_passed" "$lease_id" "$evidence_id" "$status" "$expires_at" "$resilience_json" "$lease_events_json" false ""

if [ "$gate_passed" = "true" ]; then
  printf '%s\n' "gate passed"
  exit 0
fi

if [ "$status" = "blocked_sandbox_drift" ]; then
  printf '%s\n' "gate-worktree: BLOCKED (sandbox drift): $gate_summary" >&2
  printf '%s\n' "gate-worktree: this is a sandbox defect, not product build evidence; converge the sandbox and re-run the gate" >&2
  exit 3
fi

die "gate failed"
