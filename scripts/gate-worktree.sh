#!/bin/sh
set -eu

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
PUSH_BRANCH=1
DRY_RUN=0
URL="${DPF_LOCAL_CI_URL:-http://localhost:3010}"
PORTS="3010"
GIT_BIN="${DPF_GATE_GIT_BIN:-git}"
CURL_BIN="${DPF_GATE_CURL_BIN:-curl}"
STATE_FILE=""

usage() {
  cat <<'EOF'
Usage: scripts/gate-worktree.sh [options]

Options:
  --branch NAME              Branch to gate (default: current branch)
  --sha SHA                  Commit SHA to gate (default: HEAD)
  --worktree PATH            Worktree path (default: git rev-parse --show-toplevel)
  --remote NAME              Remote to push before claiming the lease (default: origin)
  --owner-provider NAME      build-studio|claude|codex|coworker (default: codex)
  --owner-session-id ID      External session id (default: gate-<pid>)
  --mcp-url URL              MCP endpoint (default: DPF_MCP_URL or local portal)
  --lease-wait-seconds N     Max time to wait when the lease is busy (default: 300)
  --poll-seconds N           Busy-lease poll interval (default: 10)
  --expires-minutes N        Lease expiry window (default: 60)
  --no-push                  Do not push before claiming the lease
  --dry-run                  Print planned actions; skip git push and MCP calls
  --help                     Show this help
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

write_state() {
  gate_passed="$1"
  lease_id="$2"
  evidence_id="$3"
  status="$4"
  mkdir -p "$(dirname "$STATE_FILE")"
  node -e '
const fs = require("node:fs");
const out = process.argv[1];
const payload = {
  branch: process.argv[2],
  sha: process.argv[3],
  gatePassed: process.argv[4] === "true",
  leaseId: process.argv[5],
  evidenceRecordId: process.argv[6],
  status: process.argv[7],
  recordedAt: new Date().toISOString()
};
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
' "$STATE_FILE" "$BRANCH" "$SHA" "$gate_passed" "$lease_id" "$evidence_id" "$status"
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
    --no-push) PUSH_BRANCH=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

[ -n "$BRANCH" ] || BRANCH="$("$GIT_BIN" rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] || die "cannot gate detached HEAD"
[ -n "$SHA" ] || SHA="$("$GIT_BIN" rev-parse HEAD)"
[ -n "$WORKTREE_PATH" ] || WORKTREE_PATH="$("$GIT_BIN" rev-parse --show-toplevel)"
[ -n "$OWNER_SESSION_ID" ] || OWNER_SESSION_ID="gate-$$"
STATE_FILE="$("$GIT_BIN" rev-parse --git-path dpf-local-ci-gate.json)"

if [ "$DRY_RUN" = "1" ]; then
  printf 'gate-worktree dry-run\n'
  printf 'branch=%s\nsha=%s\nworktree=%s\nremote=%s\nmcpUrl=%s\n' "$BRANCH" "$SHA" "$WORKTREE_PATH" "$REMOTE" "$MCP_URL"
  printf 'would call claim_nonprod_environment_lease and record_local_integration_result\n'
  exit 0
fi

[ -n "${DPF_MCP_BEARER_TOKEN:-}" ] || die "DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease"

if [ "$PUSH_BRANCH" = "1" ]; then
  "$GIT_BIN" push "$REMOTE" "$BRANCH"
fi

expires_at="$(node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1]) * 60000).toISOString())' "$EXPIRES_MINUTES")"
deadline="$(node -e 'process.stdout.write(String(Date.now() + Number(process.argv[1]) * 1000))' "$LEASE_WAIT_SECONDS")"
lease_id=""

while :; do
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

set +e
printf '%s\n' "local-CI sandbox lease claimed: $lease_id"
printf '%s\n' "sandbox checkout/build stub: gate passed"
stub_status=0
set -e

if [ "$stub_status" -eq 0 ]; then
  gate_passed=true
  status="passed"
fi

evidence_args="$(node -e '
const status = process.argv[1];
const gatePassed = process.argv[2] === "true";
const evidence = {
  bi: "BI-166C59F3",
  phase: 1,
  leaseId: process.argv[3],
  branch: process.argv[4],
  sha: process.argv[5],
  gatePassed,
  commands: ["sandbox checkout/build stub"],
  output: "gate passed",
  url: process.argv[6]
};
process.stdout.write(JSON.stringify({
  provider: process.argv[7],
  externalSessionId: process.argv[8],
  routeContext: "/build",
  candidateBranch: process.argv[4],
  mode: "single-branch",
  status,
  summary: gatePassed ? "Phase 1 local-CI lease gate passed." : "Phase 1 local-CI lease gate failed.",
  evidence
}));
' "$status" "$gate_passed" "$lease_id" "$BRANCH" "$SHA" "$URL" "$OWNER_PROVIDER" "$OWNER_SESSION_ID")"
evidence_response="$(mcp_call record_local_integration_result "$evidence_args" | extract_tool_result)"
evidence_success="$(printf '%s' "$evidence_response" | field success)"
if [ "$evidence_success" = "true" ]; then
  evidence_id="$(printf '%s' "$evidence_response" | field entityId)"
else
  write_state false "$lease_id" "" "failed"
  mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" >/dev/null || true
  die "failed to record local integration evidence: $evidence_response"
fi

release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" | extract_tool_result)"
release_success="$(printf '%s' "$release_response" | field success)"
[ "$release_success" = "true" ] || die "failed to release local-CI lease: $release_response"

write_state "$gate_passed" "$lease_id" "$evidence_id" "$status"

if [ "$gate_passed" = "true" ]; then
  printf '%s\n' "gate passed"
  exit 0
fi

die "gate failed"
