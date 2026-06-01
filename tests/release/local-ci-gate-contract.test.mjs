import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repoRoot = new URL("../..", import.meta.url);
const script = new URL("../../scripts/gate-worktree.sh", import.meta.url);

function runGate(args, options = {}) {
  return spawnSync("sh", [script.pathname, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ? { ...options.env } : process.env,
  });
}

test("gate-worktree.sh parses explicit flags in dry-run mode", () => {
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
});

test("gate-worktree.sh exits non-zero when DPF_MCP_BEARER_TOKEN is missing", () => {
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

test("gate-worktree.sh refuses to record passing stub evidence by default", () => {
  const env = {
    ...process.env,
    DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
  };
  delete env.DPF_ALLOW_LOCAL_CI_STUB;
  delete env.DPF_LOCAL_CI_COMMAND;

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
  assert.match(result.stderr, /refusing to record passing stub evidence/);
});

test("gate-worktree.sh calls claim_nonprod_environment_lease before recording evidence when stub is explicitly allowed", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-local-ci-gate-"));
  const callsFile = join(temp, "calls.ndjson");
  const gitStub = join(temp, "git");
  const curlStub = join(temp, "curl");

  writeFileSync(gitStub, `#!/bin/sh
if [ "$1" = "rev-parse" ] && [ "$2" = "--git-path" ]; then
  echo "${temp}/gate.json"
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
    "claim_nonprod_environment_lease",
    "record_local_integration_result",
    "release_nonprod_environment_lease",
  ]);
});
