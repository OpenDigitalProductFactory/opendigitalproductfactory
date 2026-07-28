import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = fileURLToPath(new URL("../../scripts/dev-portal-lease.sh", import.meta.url));

function runLease(args, options = {}) {
  return spawnSync("sh", [scriptPath, ...args], {
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
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ]; then
  echo "feat/dev-portal-lease"
  exit 0
fi
echo "unexpected git call: $*" >&2
exit 1
`);

  const claimReply =
    mode === "queued"
      ? `'{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":true,\\"entityId\\":\\"NPEL-WAIT\\",\\"data\\":{\\"lease\\":{\\"leaseId\\":\\"NPEL-WAIT\\"},\\"admission\\":{\\"status\\":\\"queued\\",\\"queuePosition\\":2,\\"waitAgeMs\\":25}}}"}]}}'`
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
  *)
    printf '%s\\n' '{"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"{\\"success\\":false,\\"error\\":\\"unexpected_tool\\"}"}]}}'
    ;;
esac
`);
  chmodSync(gitStub, 0o755);
  chmodSync(curlStub, 0o755);
  return { callsFile, gitStub, curlStub };
}

function baseEnv(stubs, extra = {}) {
  return {
    ...process.env,
    DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
    DPF_DEV_PORTAL_GIT_BIN: stubs.gitStub,
    DPF_DEV_PORTAL_CURL_BIN: stubs.curlStub,
    DPF_DEV_WORKTREE: "/tmp/dpf-worktree",
    ...extra,
  };
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
