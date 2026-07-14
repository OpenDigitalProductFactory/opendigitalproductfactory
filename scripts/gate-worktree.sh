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
LOCAL_CI_COMMAND="${DPF_LOCAL_CI_COMMAND:-}"
ALLOW_STUB="${DPF_ALLOW_LOCAL_CI_STUB:-0}"
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

write_state() {
  gate_passed="$1"
  lease_id="$2"
  evidence_id="$3"
  status="$4"
  expires_at_value="$5"
  resilience_json="${6:-null}"
  mkdir -p "$(dirname "$STATE_FILE")"
  node -e '
const fs = require("node:fs");
const resilience = JSON.parse(process.argv[9]);
const out = process.argv[1];
const payload = {
  branch: process.argv[2],
  sha: process.argv[3],
  gatePassed: process.argv[4] === "true",
  leaseId: process.argv[5],
  evidenceRecordId: process.argv[6],
  status: process.argv[7],
  expiresAt: process.argv[8],
  recordedAt: new Date().toISOString()
};
if (resilience) payload.resilience = resilience;
fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n");
' "$STATE_FILE" "$BRANCH" "$SHA" "$gate_passed" "$lease_id" "$evidence_id" "$status" "$expires_at_value" "$resilience_json"
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

[ -n "$LOCAL_CI_COMMAND" ] || [ "$ALLOW_STUB" = "1" ] || die "local-CI gate runner is not wired (scripts/local-ci-runner.sh is missing); refusing to record passing stub evidence. Set DPF_LOCAL_CI_COMMAND to the canonical sandbox command, or use DPF_ALLOW_LOCAL_CI_STUB=1 only in contract tests."

[ -n "${DPF_MCP_BEARER_TOKEN:-}" ] || die "DPF_MCP_BEARER_TOKEN is required to claim the local-CI lease"

if [ "$PUSH_BRANCH" = "1" ]; then
  # DPF_PREPUSH_GATE_INFLIGHT: this push is part of the gate run itself — the
  # chained pre-push-gate must not demand the record we are about to produce.
  DPF_PREPUSH_GATE_INFLIGHT=1 "$GIT_BIN" push "$REMOTE" "$BRANCH"
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
gate_command_label=""
gate_output_file="$(mktemp)"
gate_output=""

set +e
printf '%s\n' "local-CI sandbox lease claimed: $lease_id"
if [ -n "$LOCAL_CI_COMMAND" ]; then
  gate_command_label="$LOCAL_CI_COMMAND"
  printf '%s\n' "running local-CI command: $LOCAL_CI_COMMAND"
  DPF_LOCAL_CI_METADATA_FILE="$METADATA_FILE" sh -c "$LOCAL_CI_COMMAND" >"$gate_output_file" 2>&1
  gate_status=$?
else
  gate_command_label="sandbox checkout/build stub"
  printf '%s\n' "sandbox checkout/build stub: gate passed (explicit test-only mode)"
  printf '%s\n' "sandbox checkout/build stub: gate passed (DPF_ALLOW_LOCAL_CI_STUB=1)" >"$gate_output_file"
  gate_status=0
fi
set -e

cat "$gate_output_file"
gate_output="$(tail -c 12000 "$gate_output_file" 2>/dev/null || cat "$gate_output_file")"
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
let contentMetadata = null;
try { contentMetadata = JSON.parse(fs.readFileSync(process.argv[14], "utf8")); } catch {}
const evidence = {
  bi: "BI-166C59F3",
  resilienceBi: "BI-76551B2D",
  freshnessBi: "BI-ECDF9520",
  phase: 1,
  leaseId: process.argv[3],
  branch: process.argv[4],
  sha: process.argv[5],
  expiresAt: process.argv[15],
  pushBeforeLease: process.argv[13] === "1",
  resilience,
  content: contentMetadata,
  gatePassed: outcome.gatePassed,
  freshness: outcome.freshness,
  commands: [process.argv[7]],
  buildCommand: process.argv[7],
  buildExitCode: Number(process.argv[12]),
  output: process.argv[8],
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
  evidence
}));
' "$status" "$gate_passed" "$lease_id" "$BRANCH" "$SHA" "$URL" "$gate_command_label" "$gate_output" "$OWNER_PROVIDER" "$OWNER_SESSION_ID" "$outcome_json" "$gate_status" "$PUSH_BRANCH" "$METADATA_FILE" "$expires_at" "$resilience_json")"
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
  write_state false "$lease_id" "" "failed" "$expires_at" "$resilience_json"
  mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" >/dev/null || true
  die "failed to record local integration evidence: $evidence_response"
fi

release_response="$(mcp_call release_nonprod_environment_lease "{\"leaseId\":$(json_escape "$lease_id")}" | extract_tool_result)"
release_success="$(printf '%s' "$release_response" | field success)"
[ "$release_success" = "true" ] || die "failed to release local-CI lease: $release_response"

write_state "$gate_passed" "$lease_id" "$evidence_id" "$status" "$expires_at" "$resilience_json"

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
