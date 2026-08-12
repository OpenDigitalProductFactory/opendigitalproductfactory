import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = fileURLToPath(new URL("../../scripts/dev-portal-lease.sh", import.meta.url));
const shellPath =
  process.platform === "win32"
  && existsSync("C:/Program Files/Git/bin/sh.exe")
    ? "C:/Program Files/Git/bin/sh.exe"
    : "sh";

function runLease(args, options = {}) {
  return spawnSync(shellPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ? { ...options.env } : process.env,
  });
}

// A curl stub that records every MCP request to callsFile and replies with the
// canned JSON-RPC response for the named tool. `mode` controls the claim reply:
//   "claimed"  -> success with a lease id
//   "queued"   -> durable FIFO admission while another holder is active
function makeStubs(temp, mode) {
  const callsFile = join(temp, "calls.ndjson");
  const dockerCallsFile = join(temp, "docker-calls.txt");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");
  const dockerStub = join(temp, "docker");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "-C" ]; then
  shift 2
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then
  echo "feat/dev-portal-lease"
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);

  const claimReply =
    mode === "queued"
      ? `'{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-WAIT\\",\\"data\\":{\\"lease\\":{\\"leaseId\\":\\"NPEL-WAIT\\"},\\"admission\\":{\\"status\\":\\"queued\\",\\"queuePosition\\":2,\\"waitAgeMs\\":25},\\"poolPolicy\\":{\\"rollbackReason\\":\\"host-memory-low\\"}}}"}]}}'`
      : `'{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-MINE\\"}"}]}}'`;

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
    printf '%s\\n' ${claimReply}
    ;;
  list_nonprod_environment_leases)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"data\\":{\\"leases\\":[{\\"leaseId\\":\\"NPEL-OTHER\\",\\"environmentKey\\":\\"local-integration-ci\\",\\"ownerProvider\\":\\"codex\\",\\"ownerSessionId\\":\\"other-session\\"}]}}"}]}}'
    ;;
  release_nonprod_environment_lease)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-MINE\\"}"}]}}'
    ;;
  renew_nonprod_environment_lease)
    if [ "\${DPF_TEST_RENEW_FAIL:-}" = "1" ]; then
      printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"lease_terminal\\",\\"data\\":{\\"reason\\":\\"expired\\"}}"}]}}'
    else
      printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"data\\":{\\"lease\\":{\\"leaseId\\":\\"NPEL-MINE\\",\\"status\\":\\"active\\",\\"expiresAt\\":\\"2026-08-09T00:00:00.000Z\\"}}}"}]}}'
    fi
    ;;
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  writeFileSync(dockerStub, `#!/bin/sh
printf '%s\\n' "$*" >> "${dockerCallsFile}"
if [ -n "\${DPF_TEST_DOCKER_DELAY_SECONDS:-}" ]; then
  sleep "\${DPF_TEST_DOCKER_DELAY_SECONDS}"
fi
if [ -n "\${DPF_DEV_PORTAL_DOCKER_FAIL_ON:-}" ] \
  && printf '%s' "$*" | grep -q "\${DPF_DEV_PORTAL_DOCKER_FAIL_ON}"; then
  exit 42
fi
exit 0
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);
  chmodSync(dockerStub, 0o755);
  return { callsFile, dockerCallsFile, gitStub, curlStub, dockerStub };
}

function baseEnv(stubs, extra = {}) {
  return {
    ...process.env,
    DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
    DPF_DEV_PORTAL_GIT_BIN: stubs.gitStub,
    DPF_DEV_PORTAL_CURL_BIN: stubs.curlStub,
    DPF_DEV_PORTAL_DOCKER_BIN: stubs.dockerStub,
    DPF_DEV_WORKTREE: "/tmp/dpf-worktree",
    DPF_DEV_PORTAL_HOST_PRESSURE_JSON: JSON.stringify({
      observedAt: "2026-08-08T20:00:00.000Z",
      availableMemoryBytes: 16 * 1024 ** 3,
      sustainedCpuPercent: 25,
      diskFreeBytes: 200 * 1024 ** 3,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    }),
    ...extra,
  };
}

function makeTerminalClaimStubs(temp, responseMode) {
  const callsFile = join(temp, "terminal-calls.ndjson");
  const gitStub = join(temp, "terminal-git");
  const curlStub = join(temp, "terminal-curl");
  writeFileSync(gitStub, "#!/bin/sh\nprintf '%s\\n' 'fix/test-preview'\n");
  writeFileSync(curlStub, `#!/bin/sh
data=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data) data="$2"; shift 2 ;;
    *) shift ;;
  esac
done
node -e '
const fs = require("node:fs");
const request = JSON.parse(process.argv[1]);
const args = request.params.arguments;
fs.appendFileSync(process.argv[2], JSON.stringify(request) + "\\n");
const base = "dev-portal:session-1:fix/test-preview";
let response;
if (process.argv[3] === "sequence") {
  if (args.claimKey === base) response = { success: false, error: "lease_terminal", data: { reason: "expired", lease: { status: "expired" } } };
  else if (args.claimKey === base + ":rerun-1") response = { success: false, error: "lease_terminal", data: { reason: "released", lease: { status: "released" } } };
  else response = { success: true, entityId: "NPEL-NEW", data: { admission: { status: "admitted" } } };
} else if (process.argv[3] === "conflict") {
  response = { success: false, error: "lease_conflict", data: { active: { leaseId: "NPEL-HELD", ownerProvider: "claude", ownerSessionId: "peer" } } };
} else {
  response = { success: false, error: "lease_terminal", data: { reason: "cancelled", lease: { status: "cancelled" } } };
}
const text = JSON.stringify(response);
process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } }));
' "$data" '${callsFile}' '${responseMode}'
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);
  return { callsFile, gitStub, curlStub };
}

function runTerminalClaim(responseMode, extraEnv = {}) {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-terminal-"));
  const stubs = makeTerminalClaimStubs(temp, responseMode);
  const result = runLease(["claim", "--worktree", "/tmp/dpf-worktree"], {
    env: {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_DEV_PORTAL_OWNER_PROVIDER: "codex",
      DPF_DEV_PORTAL_OWNER_SESSION_ID: "session-1",
      DPF_DEV_PORTAL_GIT_BIN: stubs.gitStub,
      DPF_DEV_PORTAL_CURL_BIN: stubs.curlStub,
      ...extraEnv,
    },
  });
  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  return { result, calls };
}

test("dev-portal-lease.sh exits non-zero when DPF_MCP_BEARER_TOKEN is missing", () => {
  const env = { ...process.env };
  delete env.DPF_MCP_BEARER_TOKEN;
  const result = runLease(["status"], { env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DPF_MCP_BEARER_TOKEN is required/);
});

test("dev-portal-lease.sh claim requires a worktree path", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const env = baseEnv(stubs);
  delete env.DPF_DEV_WORKTREE;
  const result = runLease(["claim"], { env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DPF_DEV_WORKTREE/);
});

test("dev-portal-lease.sh claim claims the local-integration-ci lease for :3001", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["claim"], { env: baseEnv(stubs) });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LEASE_ID=NPEL-MINE/);

  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.name, "claim_nonprod_environment_lease");
  const args = calls[0].params.arguments;
  assert.equal(args.environmentKey, "local-integration-ci");
  assert.deepEqual(args.ports, [3001]);
  assert.equal(args.url, "http://localhost:3001");
  assert.match(args.claimKey, /^dev-portal:/);
  assert.equal(args.branchName, "feat/dev-portal-lease");
  assert.match(args.claimKey, /:feat\/dev-portal-lease$/);
  assert.equal(args.hostPressure.dockerHealthy, true);
  assert.equal(args.hostPressure.convergenceActive, false);
  assert.equal(args.hostPressure.fencesHealthy, true);
  assert.equal(args.hostPressure.evidenceIsolationHealthy, true);
  // The exact prefix may be rewritten by the shell's path conversion on
  // Windows (MSYS); assert the worktree marker is carried through.
  assert.match(args.worktreePath, /dpf-worktree$/);
});

test("dev-portal-lease.sh does not treat a queued admission as ownership", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "queued");
  const result = runLease(["claim"], { env: baseEnv(stubs) });

  assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /WAITING lease NPEL-WAIT/);
  assert.match(result.stderr, /position 2/);
  assert.match(result.stderr, /host-memory-low/);
});

test("dev-portal-lease.sh advances through terminal claim history without changing owner identity", () => {
  const base = "dev-portal:session-1:fix/test-preview";
  const { result, calls } = runTerminalClaim("sequence");

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    calls.map((call) => call.params.arguments.claimKey),
    [base, `${base}:rerun-1`, `${base}:rerun-2`],
  );
  assert.ok(calls.every((call) => call.params.arguments.ownerSessionId === "session-1"));
  assert.match(result.stdout, /terminal attempt 2/);
  assert.match(result.stdout, /LEASE_ID=NPEL-NEW/);
});

test("dev-portal-lease.sh never rotates an active contention response", () => {
  const base = "dev-portal:session-1:fix/test-preview";
  const { result, calls } = runTerminalClaim("conflict");

  assert.equal(result.status, 3);
  assert.deepEqual(calls.map((call) => call.params.arguments.claimKey), [base]);
  assert.match(result.stderr, /REFUSING to silently re-bind/);
});

test("dev-portal-lease.sh fails closed after its bounded terminal claim budget", () => {
  const base = "dev-portal:session-1:fix/test-preview";
  const { result, calls } = runTerminalClaim("terminal", {
    DPF_DEV_PORTAL_MAX_TERMINAL_CLAIM_ATTEMPTS: "2",
  });

  assert.equal(result.status, 1);
  assert.deepEqual(
    calls.map((call) => call.params.arguments.claimKey),
    [base, `${base}:rerun-1`, `${base}:rerun-2`],
  );
  assert.match(result.stderr, /terminal claim retry budget exhausted/);
});

test("dev-portal-lease.sh status reports the current holder", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["status"], { env: baseEnv(stubs) });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /HELD lease NPEL-OTHER/);
});

test("dev-portal-lease.sh release releases the named lease", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["release", "--lease-id", "NPEL-MINE"], { env: baseEnv(stubs) });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /released NPEL-MINE/);
  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls[0].params.name, "release_nonprod_environment_lease");
  assert.equal(calls[0].params.arguments.leaseId, "NPEL-MINE");
});

test("dev-portal-lease.sh refresh claims before stopping and restarting the shared preview", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["refresh"], {
    env: baseEnv(stubs, {
      NODE_ENV: "test",
      DPF_DEV_PORTAL_TEST_EXIT_AFTER_READY: "1",
      DPF_DEV_PORTAL_HEARTBEAT_SECONDS: "0.05",
      DPF_TEST_DOCKER_DELAY_SECONDS: "0.25",
    }),
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls[0].params.name, "claim_nonprod_environment_lease");
  assert.ok(calls.some((call) => call.params.name === "renew_nonprod_environment_lease"));
  assert.equal(calls.at(-1).params.name, "release_nonprod_environment_lease");
  assert.deepEqual(
    readFileSync(stubs.dockerCallsFile, "utf8").trim().split("\n"),
    [
      "compose -p dpf --profile dev stop dev-portal",
      "compose -p dpf --profile dev up -d dev-portal",
    ],
  );
  assert.match(result.stdout, /LEASE_ID=NPEL-MINE/);
  assert.match(result.stdout, /heartbeat active/i);
});

test("dev-portal-lease.sh refresh releases its lease when Docker refresh fails", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["refresh"], {
    env: baseEnv(stubs, {
      NODE_ENV: "test",
      DPF_DEV_PORTAL_TEST_EXIT_AFTER_READY: "1",
      DPF_DEV_PORTAL_HEARTBEAT_SECONDS: "0.05",
      DPF_DEV_PORTAL_DOCKER_FAIL_ON: "up -d",
    }),
  });

  assert.notEqual(result.status, 0);
  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.map((call) => call.params.name),
    ["claim_nonprod_environment_lease", "release_nonprod_environment_lease"],
  );
  assert.equal(calls[1].params.arguments.leaseId, "NPEL-MINE");
});

test("dev-portal-lease.sh refresh stops the preview and releases when renewal loses authority", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-dev-portal-lease-"));
  const stubs = makeStubs(temp, "claimed");
  const result = runLease(["refresh"], {
    env: baseEnv(stubs, {
      NODE_ENV: "test",
      DPF_DEV_PORTAL_TEST_EXIT_AFTER_READY: "1",
      DPF_DEV_PORTAL_HEARTBEAT_SECONDS: "0.05",
      DPF_TEST_DOCKER_DELAY_SECONDS: "0.25",
      DPF_TEST_RENEW_FAIL: "1",
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /lease authority lost/i);
  const calls = readFileSync(stubs.callsFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(calls.some((call) => call.params.name === "renew_nonprod_environment_lease"));
  assert.equal(calls.at(-1).params.name, "release_nonprod_environment_lease");
  const dockerCalls = readFileSync(stubs.dockerCallsFile, "utf8").trim().split("\n");
  assert.ok(dockerCalls.filter((call) => call === "compose -p dpf --profile dev stop dev-portal").length >= 2);
});
