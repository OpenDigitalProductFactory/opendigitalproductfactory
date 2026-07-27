import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const script = fileURLToPath(new URL("../../scripts/gate-worktree.sh", import.meta.url));
const nativeShellProbe = spawnSync("sh", ["-c", "printf ok"], { encoding: "utf8" });
const shellContractSkipReason = nativeShellProbe.error
  ? "native POSIX shell 'sh' is unavailable on this host; shell contracts run in CI/Linux or Git Bash-equipped worktrees"
  : false;
const shellContractTest = (name, fn) => test(name, { skip: shellContractSkipReason }, fn);

function runGate(args, options = {}) {
  return spawnSync("sh", [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ? { ...options.env } : process.env,
  });
}

shellContractTest("gate-worktree.sh parses explicit flags in dry-run mode", () => {
  const result = runGate([
    "--dry-run",
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    "/tmp/dpf-worktree",
    "--remote",
    "coordination",
    "--mcp-url",
    "http://127.0.0.1:3000/api/mcp/v1",
    "--no-push",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /branch=feat\/local-ci-sandbox/);
  assert.match(result.stdout, /sha=abc123/);
  assert.match(result.stdout, /worktree=\/tmp\/dpf-worktree/);
  assert.match(result.stdout, /remote=coordination/);
  assert.match(result.stdout, /pushBeforeLease=false/);
});

shellContractTest("gate-worktree.sh exposes push-before-lease only as an explicit dry-run mode", () => {
  const result = runGate([
    "--dry-run",
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    "/tmp/dpf-worktree",
    "--push",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pushBeforeLease=true/);
});

shellContractTest("gate-worktree.sh exits non-zero when DPF_MCP_BEARER_TOKEN is missing", () => {
  const env = { ...process.env };
  delete env.DPF_MCP_BEARER_TOKEN;
  env.DPF_ALLOW_LOCAL_CI_STUB = "1";
  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    "/tmp/dpf-worktree",
    "--no-push",
  ], { env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DPF_MCP_BEARER_TOKEN is required/);
});

shellContractTest("gate-worktree.sh discovers the checked-in default runner when DPF_LOCAL_CI_COMMAND is unset (BI-157DC9B2)", () => {
  const env = { ...process.env };
  delete env.DPF_ALLOW_LOCAL_CI_STUB;
  delete env.DPF_LOCAL_CI_COMMAND;

  const result = runGate([
    "--dry-run",
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    "/tmp/dpf-worktree",
    "--no-push",
  ], { env });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /localCiCommand=sh '.*local-ci-runner\.sh' --candidate 'feat\/local-ci-sandbox'/);
  assert.ok(!result.stdout.includes("localCiCommand=missing"));
});

shellContractTest("gate-worktree.sh still refuses to run when neither an explicit command, the stub, nor the checked-in runner exists", () => {
  // Exercise the refuse path by running a copy of the script from a directory
  // with no sibling local-ci-runner.sh (SCRIPT_DIR discovery finds nothing).
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const scriptCopy = join(temp, "gate-worktree.sh");
  writeFileSync(scriptCopy, readFileSync(new URL("../../scripts/gate-worktree.sh", import.meta.url), "utf8"));
  chmodSync(scriptCopy, 0o755);

  const env = {
    ...process.env,
    DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
  };
  delete env.DPF_ALLOW_LOCAL_CI_STUB;
  delete env.DPF_LOCAL_CI_COMMAND;

  const result = spawnSync("sh", [scriptCopy,
    "--branch", "feat/local-ci-sandbox",
    "--sha", "abc123",
    "--worktree", "/tmp/dpf-worktree",
    "--no-push",
  ], { cwd: repoRoot, encoding: "utf8", env });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to record passing stub evidence/);
});

shellContractTest("gate-worktree.sh records blocked_sandbox_drift (exit 3), not a product failure, when the freshness report is red", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  // Per-name --git-path so the freshness report and the gate state file get
  // distinct paths, like real git.
  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/$3"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-common-dir" ]; then
  echo "${temp}"
  exit 0
fi
if [ "$1" = "push" ]; then
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"STUB\\"}"}]}}'
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  // A drift report as the preflight would leave it: stale next link vs lockfile.
  writeFileSync(join(temp, "dpf-sandbox-freshness.json"), JSON.stringify({
    schema: "dpf-sandbox-freshness/v1",
    verdict: "sandbox_drift",
    failures: [{ kind: "version_drift", message: "apps/web/node_modules/next resolves to 16.2.7 but pnpm-lock.yaml requires 16.2.9" }],
    packages: [{ name: "next", lockedVersion: "16.2.9", resolvedVersion: "16.2.7" }],
    convergence: { attempted: true, command: "pnpm install --frozen-lockfile", exitCode: 1 },
  }));

  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    temp,
    "--no-push",
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_LOCAL_CI_COMMAND: "exit 3",
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 3, `expected sandbox-drift exit 3, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /BLOCKED \(sandbox drift\)/);
  assert.match(result.stderr, /not product build evidence/);

  const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const evidenceCall = calls.find((call) => call.params.name === "record_local_integration_result");
  assert.ok(evidenceCall, "expected evidence to be recorded");
  assert.equal(evidenceCall.params.arguments.status, "blocked_sandbox_drift");
  assert.match(evidenceCall.params.arguments.summary, /NOT product build evidence/);
  assert.equal(evidenceCall.params.arguments.evidence.freshness.verdict, "sandbox_drift");
  assert.equal(evidenceCall.params.arguments.evidence.gatePassed, false);
  const nextEntry = evidenceCall.params.arguments.evidence.freshness.packages.find((p) => p.name === "next");
  assert.deepEqual(nextEntry, { name: "next", locked: "16.2.9", resolved: "16.2.7" });

  const state = JSON.parse(readFileSync(join(temp, "dpf-local-ci-gate.json"), "utf8"));
  assert.equal(state.gatePassed, false);
  assert.equal(state.status, "blocked_sandbox_drift");
});

shellContractTest("gate-worktree.sh calls claim_nonprod_environment_lease before recording evidence when stub is explicitly allowed", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/gate.json"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-common-dir" ]; then
  echo "${temp}"
  exit 0
fi
if [ "$1" = "push" ]; then
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  claim_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  renew_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"EXT-TEST\\"}"}]}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    temp,
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_ALLOW_LOCAL_CI_STUB: "1",
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const calls = readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).params.name);
  assert.deepEqual(calls, [
    "get_quiescence_status",
    "list_nonprod_environment_leases",
    "claim_nonprod_environment_lease",
    "release_nonprod_environment_lease",
    "record_local_integration_result",
  ]);
});

shellContractTest("gate-worktree.sh does not push before claiming the local-CI lease by default (BI-76551B2D)", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/gate.json"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-common-dir" ]; then
  echo "${temp}"
  exit 0
fi
if [ "$1" = "push" ]; then
  echo "unexpected push before local evidence: $*" >&2
  exit 42
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  claim_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  renew_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"EXT-TEST\\"}"}]}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    temp,
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_ALLOW_LOCAL_CI_STUB: "1",
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const calls = readFileSync(callsFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).params.name);
  assert.deepEqual(calls, [
    "get_quiescence_status",
    "list_nonprod_environment_leases",
    "claim_nonprod_environment_lease",
    "release_nonprod_environment_lease",
    "record_local_integration_result",
  ]);
});

shellContractTest("gate-worktree.sh preserves a passed gate when evidence recording is quiescence-blocked", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-quiescence-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/$3"
  exit 0
fi
if [ "$1" = "push" ]; then
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  get_quiescence_status)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"data\\":{\\"level\\":\\"normal\\",\\"writesRefused\\":false}}"}]}}'
    ;;
  claim_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-Q\\"}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"portal_quiescing\\",\\"message\\":\\"Mutating MCP write refused during draining.\\",\\"data\\":{\\"level\\":\\"draining\\",\\"runId\\":\\"QR-Q\\",\\"retryAfterSeconds\\":30,\\"writesRefused\\":true}}"}],"structuredContent":{"error":"portal_quiescing","level":"draining","runId":"QR-Q","retryAfterSeconds":30,"writesRefused":true},"isError":true}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-Q\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    temp,
    "--no-push",
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_LOCAL_CI_COMMAND: "exit 0",
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 4, `expected pending-evidence exit 4, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /local-CI gate passed but evidence recording is pending/i);
  assert.match(result.stderr, /--finalize-evidence/);

  const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).params.name);
  assert.deepEqual(calls, [
    "get_quiescence_status",
    "list_nonprod_environment_leases",
    "claim_nonprod_environment_lease",
    "release_nonprod_environment_lease",
    "record_local_integration_result",
  ]);

  const state = JSON.parse(readFileSync(join(temp, "dpf-local-ci-gate.json"), "utf8"));
  assert.equal(state.gatePassed, true);
  assert.equal(state.status, "passed");
  assert.equal(state.evidencePending, true);
  assert.equal(state.evidencePendingReason, "portal_quiescing");
  assert.equal(state.leaseId, "NPEL-Q");
  assert.ok(existsSync(join(temp, "dpf-local-ci-pending-evidence.json")));
});

shellContractTest("gate-worktree.sh --finalize-evidence records pending evidence without rerunning the expensive gate", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-finalize-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/$3"
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  get_quiescence_status)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"data\\":{\\"level\\":\\"normal\\",\\"writesRefused\\":false}}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"EXT-LATE\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  writeFileSync(join(temp, "dpf-local-ci-pending-evidence.json"), JSON.stringify({
    schema: "dpf-local-ci-pending-evidence/v1",
    branch: "feat/local-ci-sandbox",
    sha: "abc123",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    recordArgs: {
      branch: "feat/local-ci-sandbox",
      sha: "abc123",
      status: "passed",
      summary: "local-CI passed; evidence replay",
      evidence: { gatePassed: true },
    },
  }));

  const result = runGate([
    "--finalize-evidence",
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "abc123",
    "--worktree",
    temp,
    "--no-push",
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /recorded pending local-CI evidence/i);
  const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).params.name);
  assert.deepEqual(calls, [
    "get_quiescence_status",
    "record_local_integration_result",
  ]);

  const state = JSON.parse(readFileSync(join(temp, "dpf-local-ci-gate.json"), "utf8"));
  assert.equal(state.gatePassed, true);
  assert.equal(state.evidencePending, false);
  assert.equal(state.evidenceRecordId, "EXT-LATE");
});

shellContractTest("gate-worktree.sh includes content-addressed local integration metadata in evidence (BI-76551B2D)", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");
  const writerScript = join(temp, "write-metadata.mjs");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/$3"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-common-dir" ]; then
  echo "${temp}"
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  claim_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  renew_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"EXT-TEST\\"}"}]}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-TEST\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  writeFileSync(writerScript, `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.DPF_LOCAL_CI_METADATA_FILE, JSON.stringify({
  schemaVersion: 1,
  bi: "BI-76551B2D",
  candidateRef: "feat/local-ci-sandbox",
  candidateSha: "candidate-sha",
  baseRef: "origin/main",
  fetchBase: false,
  baseSha: "base-sha",
  integrationCommitSha: "integration-sha",
  synthesizedTreeSha: "tree-sha",
  toolchainFingerprint: "toolchain-sha",
  toolchain: { nodeVersion: "v24.0.0" }
}) + "\\n");
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);

  const result = runGate([
    "--branch",
    "feat/local-ci-sandbox",
    "--sha",
    "candidate-sha",
    "--worktree",
    temp,
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_LOCAL_CI_COMMAND: `"${process.execPath}" "${writerScript}"`,
      DPF_GATE_GIT_BIN: gitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const evidenceCall = calls.find((call) => call.params.name === "record_local_integration_result");
  assert.ok(evidenceCall, "expected evidence to be recorded");
  assert.deepEqual(evidenceCall.params.arguments.evidence.content, {
    schemaVersion: 1,
    bi: "BI-76551B2D",
    candidateRef: "feat/local-ci-sandbox",
    candidateSha: "candidate-sha",
    baseRef: "origin/main",
    fetchBase: false,
    baseSha: "base-sha",
    integrationCommitSha: "integration-sha",
    synthesizedTreeSha: "tree-sha",
    toolchainFingerprint: "toolchain-sha",
    toolchain: { nodeVersion: "v24.0.0" },
  });
  assert.deepEqual(evidenceCall.params.arguments.evidence.resilience, {
    publicationMode: "deferred",
    acceptedBaseMode: "local-ref",
    networkTolerance: "offline-capable",
  });
  assert.match(evidenceCall.params.arguments.evidence.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  const state = JSON.parse(readFileSync(join(temp, "dpf-local-ci-gate.json"), "utf8"));
  assert.equal(state.expiresAt, evidenceCall.params.arguments.evidence.expiresAt);
  assert.deepEqual(state.resilience, evidenceCall.params.arguments.evidence.resilience);
});

shellContractTest("gate-worktree.sh records local-only evidence that pre-push can later publish without network git operations (BI-76551B2D)", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const sha = g(["rev-parse", "HEAD"]);

  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-offline-"));
  const callsFile = join(temp, "calls.ndjson");
  const gateGitStub = join(temp, "gate-git");
  const curlStub = join(temp, "curl");
  const writerScript = join(temp, "write-metadata.mjs");

  writeFileSync(gateGitStub, `#!/bin/sh
case "$1" in
  fetch|push|pull|clone|ls-remote)
    echo "network git operation forbidden during offline proof: $*" >&2
    exit 42
    ;;
esac
if [ "$1" = "remote" ] && [ "$2" = "update" ]; then
  echo "network git operation forbidden during offline proof: $*" >&2
  exit 42
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${dir}/.git/$3"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-common-dir" ]; then
  echo "${dir}/.git"
  exit 0
fi
echo "unexpected gate git call: $*" >&2
exit 1
`);
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$data" >> "${callsFile}"
tool="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); console.log(p.params.name)' <<EOF
$data
EOF
)"
case "$tool" in
  claim_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-OFFLINE\\"}"}]}}'
    ;;
  record_local_integration_result)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"EXT-OFFLINE\\"}"}]}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-OFFLINE\\"}"}]}}'
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  writeFileSync(writerScript, `
import { writeFileSync } from "node:fs";
writeFileSync(process.env.DPF_LOCAL_CI_METADATA_FILE, JSON.stringify({
  schemaVersion: 1,
  bi: "BI-76551B2D",
  candidateRef: "feat/topic",
  candidateSha: "${sha}",
  baseRef: "refs/dpf/integration/main",
  fetchBase: false,
  baseSha: "base-sha",
  integrationCommitSha: "integration-sha",
  synthesizedTreeSha: "tree-sha",
  toolchainFingerprint: "toolchain-sha"
}) + "\\n");
`);
  chmodSync(gateGitStub, 0o755);
  chmodSync(curlStub, 0o755);

  const gateResult = runGate([
    "--branch",
    "feat/topic",
    "--sha",
    sha,
    "--worktree",
    dir,
    "--no-push",
  ], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_LOCAL_CI_COMMAND: `"${process.execPath}" "${writerScript}"`,
      DPF_GATE_GIT_BIN: gateGitStub,
      DPF_GATE_CURL_BIN: curlStub,
    },
  });
  assert.equal(gateResult.status, 0, `${gateResult.stdout}\n${gateResult.stderr}`);

  const calls = readFileSync(callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const evidenceCall = calls.find((call) => call.params.name === "record_local_integration_result");
  assert.ok(evidenceCall, "expected evidence to be recorded");
  assert.deepEqual(evidenceCall.params.arguments.evidence.resilience, {
    publicationMode: "deferred",
    acceptedBaseMode: "local-ref",
    networkTolerance: "offline-capable",
  });

  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const pathStubDir = mkdtempSync(join(tmpdir(), "dpf-no-network-git-"));
  writeFileSync(join(pathStubDir, "git"), `#!/bin/sh
case "$1" in
  fetch|push|pull|clone|ls-remote)
    echo "network git operation forbidden during publication replay proof: $*" >&2
    exit 42
    ;;
esac
if [ "$1" = "remote" ] && [ "$2" = "update" ]; then
  echo "network git operation forbidden during publication replay proof: $*" >&2
  exit 42
fi
exec "${realGit}" "$@"
`);
  chmodSync(join(pathStubDir, "git"), 0o755);

  const publishReplay = runGateHook(dir, {
    input: refsLine(g),
    env: cleanHookEnv({ PATH: `${pathStubDir}:${process.env.PATH}` }),
  });
  assert.equal(publishReplay.status, 0, `${publishReplay.stdout}\n${publishReplay.stderr}`);
  assert.match(publishReplay.stdout, /local-CI gate passed/);
});

// ── pre-push hook chain + pre-push-gate contract (BI-C74F4DE9) ───────────────

// The tracked hook body — the local `pre-push` shim is gitignored (git-lfs
// generates it; postinstall converges it to delegate here), so CI checkouts
// only carry this file. Shim convergence is covered by
// scripts/lib/ensure-pre-push-hook.test.mjs.
const prePushHook = fileURLToPath(new URL("../../.githooks/lib/pre-push-chained.sh", import.meta.url));
const prePushGate = fileURLToPath(new URL("../../.githooks/pre-push-gate", import.meta.url));
const runnerScript = fileURLToPath(new URL("../../scripts/local-ci-runner.sh", import.meta.url));

function cleanHookEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.DPF_SKIP_PREPUSH_GATE;
  delete env.DPF_SKIP_PREPUSH_GATE_REASON;
  delete env.DPF_PREPUSH_GATE_INFLIGHT;
  delete env.DPF_PREPUSH_BASE_REF;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-prepush-"));
  const g = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@dpf.local"]);
  g(["config", "user.name", "dpf-test"]);
  g(["config", "commit.gpgsign", "false"]);
  g(["remote", "add", "origin", "https://example.invalid/repo.git"]);
  writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
  g(["add", "."]);
  g(["commit", "-q", "-m", "base"]);
  const baseSha = g(["rev-parse", "HEAD"]);
  g(["update-ref", "refs/remotes/origin/main", baseSha]);
  g(["checkout", "-q", "-b", "feat/topic"]);
  return { dir, g };
}

function runGateHook(dir, { input, env } = {}) {
  return spawnSync("sh", [prePushGate], {
    cwd: dir,
    encoding: "utf8",
    input: input ?? "",
    env: env ?? cleanHookEnv(),
  });
}

function refsLine(g) {
  const sha = g(["rev-parse", "HEAD"]);
  return `refs/heads/feat/topic ${sha} refs/heads/feat/topic 0000000000000000000000000000000000000000\n`;
}

shellContractTest("pre-push-gate blocks a runtime-code push with no gate record and points at pregate", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No local-CI gate record/);
  assert.match(result.stderr, /pnpm run pregate/);
});

shellContractTest("pre-push-gate passes with a matching passing gate record for branch+SHA", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const sha = g(["rev-parse", "HEAD"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({
    branch: "feat/topic",
    sha,
    gatePassed: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /local-CI gate passed/);
});

shellContractTest("pre-push-gate blocks a matching gate record while evidence publication is pending", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const sha = g(["rev-parse", "HEAD"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({
    branch: "feat/topic",
    sha,
    gatePassed: true,
    evidencePending: true,
    evidencePendingReason: "portal_quiescing",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local-CI gate passed but evidence publication is still pending/i);
  assert.match(result.stderr, /pnpm run pregate -- --finalize-evidence/);
});

shellContractTest("pre-push-gate blocks an expired matching gate record", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const sha = g(["rev-parse", "HEAD"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({
    branch: "feat/topic",
    sha,
    gatePassed: true,
    expiresAt: "2000-01-01T00:00:00.000Z",
  }));
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local-CI gate record expired/);
  assert.match(result.stderr, /pnpm run pregate/);
});

shellContractTest("pre-push-gate blocks a matching gate record without expiry metadata", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const sha = g(["rev-parse", "HEAD"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({ branch: "feat/topic", sha, gatePassed: true }));
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing expiresAt/);
  assert.match(result.stderr, /pnpm run pregate/);
});

shellContractTest("pre-push-gate blocks a stale record (older SHA) and calls out the mismatch", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({ branch: "feat/topic", sha: "stale000", gatePassed: true }));
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not pass for this HEAD/);
});

shellContractTest("pre-push-gate override requires a reason and RECORDS it (no silent skip)", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);

  const noReason = runGateHook(dir, { input: refsLine(g), env: cleanHookEnv({ DPF_SKIP_PREPUSH_GATE: "1" }) });
  assert.notEqual(noReason.status, 0);
  assert.match(noReason.stderr, /requires DPF_SKIP_PREPUSH_GATE_REASON/);

  const withReason = runGateHook(dir, {
    input: refsLine(g),
    env: cleanHookEnv({ DPF_SKIP_PREPUSH_GATE: "1", DPF_SKIP_PREPUSH_GATE_REASON: "WIP recovery push" }),
  });
  assert.equal(withReason.status, 0, withReason.stderr);
  const state = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
  assert.equal(state.skipped, true);
  assert.equal(state.skipReason, "WIP recovery push");
  assert.equal(state.gatePassed, false);
});

shellContractTest("pre-push-gate lets docs-only diffs through without a record", () => {
  const { dir, g } = makeTempRepo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "note.md"), "# doc\n");
  g(["add", "."]);
  g(["commit", "-qm", "docs change"]);
  const result = runGateHook(dir, { input: refsLine(g) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs-only diff/);
});

shellContractTest("pre-push-gate can use a configured local accepted-base ref for docs-only detection", () => {
  const { dir, g } = makeTempRepo();
  const baseSha = g(["rev-parse", "refs/remotes/origin/main"]);
  g(["update-ref", "refs/dpf/integration/main", baseSha]);
  g(["update-ref", "-d", "refs/remotes/origin/main"]);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "note.md"), "# doc\n");
  g(["add", "."]);
  g(["commit", "-qm", "docs change"]);
  const result = runGateHook(dir, {
    input: refsLine(g),
    env: cleanHookEnv({ DPF_PREPUSH_BASE_REF: "refs/dpf/integration/main" }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /docs-only diff vs refs\/dpf\/integration\/main/);
});

shellContractTest("pre-push-gate requires evidence when the configured docs-only base ref is missing", () => {
  const { dir, g } = makeTempRepo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "note.md"), "# doc\n");
  g(["add", "."]);
  g(["commit", "-qm", "docs change"]);
  const result = runGateHook(dir, {
    input: refsLine(g),
    env: cleanHookEnv({ DPF_PREPUSH_BASE_REF: "refs/dpf/missing/main" }),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No local-CI gate record/);
  assert.doesNotMatch(result.stdout, /docs-only diff/);
});

shellContractTest("pre-push-gate skips delete-only and tag-only pushes", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const del = runGateHook(dir, { input: "(delete) 0000000000000000000000000000000000000000 refs/heads/feat/old abc123\n" });
  assert.equal(del.status, 0, del.stderr);
  assert.match(del.stdout, /delete\/tag-only/);
  const sha = g(["rev-parse", "HEAD"]);
  const tag = runGateHook(dir, { input: `refs/tags/v1 ${sha} refs/tags/v1 0000000000000000000000000000000000000000\n` });
  assert.equal(tag.status, 0, tag.stderr);
});

shellContractTest("pre-push-gate defers to an in-flight gate-worktree run (its push must not deadlock)", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);
  const result = runGateHook(dir, { input: refsLine(g), env: cleanHookEnv({ DPF_PREPUSH_GATE_INFLIGHT: "1" }) });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /gate run in progress/);
});

shellContractTest("pre-push-gate skips main (merge queue governs it)", () => {
  const { dir, g } = makeTempRepo();
  g(["checkout", "-q", "main"]);
  writeFileSync(join(dir, "code.ts"), "export const x = 3;\n");
  g(["commit", "-aqm", "on main"]);
  const sha = g(["rev-parse", "HEAD"]);
  const result = runGateHook(dir, { input: `refs/heads/main ${sha} refs/heads/main 0000000000000000000000000000000000000000\n` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /merge queue/);
});

shellContractTest("pre-push chains BOTH git-lfs and the gate (gate blocks, LFS still ran)", () => {
  const { dir, g } = makeTempRepo();
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-aqm", "runtime change"]);

  // PATH-stub `git lfs pre-push`: record the call, swallow stdin, succeed.
  // The tracked hook calls `git lfs ...` rather than invoking `git-lfs`
  // directly, so the fixture intercepts the git front door and delegates every
  // non-LFS command to the real binary.
  const stubDir = mkdtempSync(join(tmpdir(), "dpf-lfs-stub-"));
  const marker = join(stubDir, "lfs-ran");
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(stubDir, "git"), `#!/bin/sh
if [ "$1" = "lfs" ] && [ "$2" = "pre-push" ]; then
  cat >/dev/null
  touch "${marker}"
  exit 0
fi
exec "${realGit}" "$@"
`);
  writeFileSync(join(stubDir, "git-lfs"), `#!/bin/sh
if [ "$1" = "pre-push" ]; then cat >/dev/null; fi
touch "${marker}"
exit 0
`);
  chmodSync(join(stubDir, "git"), 0o755);
  chmodSync(join(stubDir, "git-lfs"), 0o755);

  // The repo has no gate record → the chained gate must block the push, and
  // the LFS half must already have run.
  const blocked = spawnSync("sh", [prePushHook, "origin", "https://example.invalid/repo.git"], {
    cwd: dir,
    encoding: "utf8",
    input: refsLine(g),
    env: cleanHookEnv({ PATH: `${stubDir}:${process.env.PATH}` }),
  });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /No local-CI gate record/);
  assert.ok(existsSync(marker), "git-lfs pre-push must run before the gate");

  // With a passing record the whole chain goes green.
  const sha = g(["rev-parse", "HEAD"]);
  writeFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), JSON.stringify({
    branch: "feat/topic",
    sha,
    gatePassed: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  const ok = spawnSync("sh", [prePushHook, "origin", "https://example.invalid/repo.git"], {
    cwd: dir,
    encoding: "utf8",
    input: refsLine(g),
    env: cleanHookEnv({ PATH: `${stubDir}:${process.env.PATH}` }),
  });
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.stdout, /local-CI gate passed/);
});

// ── checked-in default runner (BI-157DC9B2) ──────────────────────────────────

shellContractTest("local-ci-runner.sh --dry-run resolves candidate, root and a non-mutating scratch workspace", () => {
  const result = spawnSync("sh", [runnerScript, "--dry-run", "--candidate", "feat/topic"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /local-ci-runner dry-run/);
  assert.match(result.stdout, /candidate=feat\/topic/);
  assert.match(result.stdout, /workspace=.*\.local-ci-runner/);
  assert.match(result.stdout, /plan=node scripts\/local-integration-ci\.mjs --candidate feat\/topic/);
});

shellContractTest("local-ci-runner.sh refuses to gate main or a detached HEAD", () => {
  const onMain = spawnSync("sh", [runnerScript, "--dry-run", "--candidate", "main"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.notEqual(onMain.status, 0);
  assert.match(onMain.stderr, /gate topic branches, not main/);
});

// ── shared-object-store self-repair (BI-AA2201B0) ────────────────────────────
// The scratch merge workspace is a linked worktree of the root clone and
// shares its .git/shallow. A disjoint shallow graft there makes the merge
// step fail with "refusing to merge unrelated histories" even when the
// branches share real ancestry on the remote. local-ci-runner.sh must
// unshallow the root once, up front, before that merge ever runs.

function stubGitFor(shallow) {
  const stubDir = mkdtempSync(join(tmpdir(), "dpf-local-ci-shallow-stub-"));
  const callsFile = join(stubDir, "calls.log");
  const fakeRoot = join(stubDir, "fake-root").replace(/\\/g, "/");
  writeFileSync(join(stubDir, "git"), `#!/bin/sh
echo "$*" >> "${callsFile}"
case "$*" in
  "rev-parse --show-toplevel")
    echo "${fakeRoot}" ;;
  "-C ${fakeRoot} worktree list --porcelain")
    echo "worktree ${fakeRoot}" ;;
  "-C ${fakeRoot} rev-parse --is-shallow-repository")
    echo "${shallow ? "true" : "false"}" ;;
  "-C ${fakeRoot} fetch --unshallow origin")
    exit 0 ;;
  *)
    exit 7 ;;
esac
`);
  chmodSync(join(stubDir, "git"), 0o755);
  return { stubDir, callsFile };
}

shellContractTest("local-ci-runner.sh unshallows the root clone before merging when the root is shallow", () => {
  const { stubDir, callsFile } = stubGitFor(true);
  const metadataFile = join(stubDir, "metadata.json");

  const result = spawnSync("sh", [runnerScript, "--candidate", "feat/topic"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      DPF_LOCAL_CI_METADATA_FILE: metadataFile,
    },
  });

  const calls = readFileSync(callsFile, "utf8");
  assert.match(calls, /-C .*fake-root rev-parse --is-shallow-repository/);
  assert.match(calls, /-C .*fake-root fetch --unshallow origin/);
  assert.match(result.stdout, /root clone is shallow.*BI-AA2201B0/);
  // Stub git doesn't understand `rev-parse --verify`, so the script dies
  // resolving the candidate sha next — proving the unshallow step ran
  // BEFORE any merge attempt, without needing to fake the whole pipeline.
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /candidate ref not found locally/);
});

shellContractTest("local-ci-runner.sh skips the unshallow fetch when the root clone is already full", () => {
  const { stubDir, callsFile } = stubGitFor(false);
  const metadataFile = join(stubDir, "metadata.json");

  spawnSync("sh", [runnerScript, "--candidate", "feat/topic"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      DPF_LOCAL_CI_METADATA_FILE: metadataFile,
    },
  });

  const calls = readFileSync(callsFile, "utf8");
  assert.match(calls, /-C .*fake-root rev-parse --is-shallow-repository/);
  assert.doesNotMatch(calls, /fetch --unshallow/);
});

shellContractTest("local-ci-runner.sh --dry-run never fetches --unshallow even on a shallow root", () => {
  const { stubDir, callsFile } = stubGitFor(true);
  const metadataFile = join(stubDir, "metadata.json");

  const result = spawnSync("sh", [runnerScript, "--dry-run", "--candidate", "feat/topic"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      DPF_LOCAL_CI_METADATA_FILE: metadataFile,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(callsFile, "utf8");
  assert.doesNotMatch(calls, /fetch --unshallow/);
});
