// Node-native pregate contract (BI-2272D840).
//
// Covers the fallback path scripts/pregate.mjs routes to when a worktree has
// no working native `sh` — scripts/gate-worktree.mjs and
// scripts/local-ci-runner.mjs. Node-path tests deliberately never require
// `sh`; the one routing parity check is explicitly skipped when a native
// POSIX shell is unavailable. The full sh-path contract stays covered by
// tests/release/local-ci-gate-contract.test.mjs.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { detectWorkingShell } from "../../scripts/pregate.mjs";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pregateScript = join(repoRoot, "scripts", "pregate.mjs");
const gateScript = join(repoRoot, "scripts", "gate-worktree.mjs");
const runnerScript = join(repoRoot, "scripts", "local-ci-runner.mjs");
const nativeShellProbe = spawnSync("sh", ["-c", "printf ok"], { encoding: "utf8" });
const shellContractSkipReason = nativeShellProbe.error
  ? "native POSIX shell 'sh' is unavailable on this host; shell routing parity runs in CI/Linux or Git Bash-equipped worktrees"
  : false;
const shellContractTest = (name, fn) => test(name, { skip: shellContractSkipReason }, fn);

function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dpf-node-gate-"));
  const g = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "test@dpf.local"]);
  g(["config", "user.name", "dpf-test"]);
  g(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
  g(["add", "."]);
  g(["commit", "-q", "-m", "base"]);
  return { dir, g };
}

// CodeQL js/unvalidated-dynamic-method-call: the mock server below picks a
// handler by a tool name read off the request body, so it must not dispatch
// through a request-controlled key (`handlers[toolName]` / `map.get(toolName)`
// both count as "user-controlled" dispatch to CodeQL's taint tracking). This
// resolver instead switches on literal tool-name cases — the bounded MCP
// tools this gate uses — so every property access is a fixed
// literal, never the tainted variable itself.
function resolveMockHandler(handlers, toolName) {
  switch (toolName) {
    case "get_quiescence_status":
      return handlers.get_quiescence_status
        ?? (() => ({ success: true, data: { level: "normal", writesRefused: false, retryAfterSeconds: 0 } }));
    case "list_nonprod_environment_leases":
      return handlers.list_nonprod_environment_leases
        ?? (() => ({ success: true, data: { leases: [] } }));
    case "claim_nonprod_environment_lease": return handlers.claim_nonprod_environment_lease;
    case "renew_nonprod_environment_lease":
      return handlers.renew_nonprod_environment_lease
        ?? (() => ({ success: true }));
    case "record_local_integration_result": return handlers.record_local_integration_result;
    case "release_nonprod_environment_lease": return handlers.release_nonprod_environment_lease;
    default: return undefined;
  }
}

async function startMockMcp(handlers) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      calls.push(request);
      const toolName = request.params.name;
      const handler = resolveMockHandler(handlers, toolName) ?? (() => ({ success: false, error: "unexpected_tool" }));
      const result = handler(request.params.arguments);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/mcp/v1`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runGate(args, env) {
  return spawnSync(process.execPath, [gateScript, ...args], { encoding: "utf8", env });
}

// Tests that pair a child gate process with an in-process mock MCP server
// MUST spawn asynchronously: spawnSync blocks this process's event loop for
// its entire duration, which would starve the very http.Server the child
// needs to reach (self-deadlock — the child would hang until it times out).
function runGateAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [gateScript, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// ── scripts/pregate.mjs: shell detection + routing ──────────────────────────

test("detectWorkingShell returns false when sh is not runnable", () => {
  const spawnSyncImpl = () => ({ status: 1, error: new Error("boom"), stdout: "" });
  assert.equal(detectWorkingShell({ spawnSyncImpl }), false);
});

test("detectWorkingShell returns false when sh exits non-zero (present but non-functional)", () => {
  const spawnSyncImpl = () => ({ status: 1, stdout: "" });
  assert.equal(detectWorkingShell({ spawnSyncImpl }), false);
});

test("detectWorkingShell returns true when sh can resolve the worktree's git state", () => {
  const spawnSyncImpl = () => ({ status: 0, stdout: "/some/worktree\n" });
  assert.equal(detectWorkingShell({ spawnSyncImpl }), true);
});

test("detectWorkingShell honors DPF_PREGATE_FORCE_NODE=1 regardless of sh availability", () => {
  const spawnSyncImpl = () => ({ status: 0, stdout: "/some/worktree\n" });
  const original = process.env.DPF_PREGATE_FORCE_NODE;
  process.env.DPF_PREGATE_FORCE_NODE = "1";
  try {
    assert.equal(detectWorkingShell({ spawnSyncImpl }), false);
  } finally {
    if (original === undefined) delete process.env.DPF_PREGATE_FORCE_NODE;
    else process.env.DPF_PREGATE_FORCE_NODE = original;
  }
});

test("pregate.mjs routes to gate-worktree.mjs (Node path) when forced, and reaches its dry-run output", () => {
  const result = spawnSync(process.execPath, [pregateScript, "--dry-run", "--branch", "feat/x", "--worktree", repoRoot], {
    encoding: "utf8",
    env: { ...process.env, DPF_PREGATE_FORCE_NODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /routing through the Node-native gate/);
  assert.match(result.stdout, /gate-worktree dry-run/);
  assert.match(result.stdout, /branch=feat\/x/);
});

shellContractTest("pregate.mjs routes to sh scripts/gate-worktree.sh when a working native shell is confirmed", () => {
  const result = spawnSync(process.execPath, [pregateScript, "--dry-run", "--branch", "feat/x", "--worktree", repoRoot], {
    encoding: "utf8",
    env: { ...process.env, DPF_PREGATE_FORCE_SH: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /routing through the Node-native gate/);
  assert.match(result.stdout, /gate-worktree dry-run/);
});

// ── scripts/gate-worktree.mjs: dry-run + refusal contract ───────────────────

test("gate-worktree.mjs dry-run reports the checked-in Node runner as the default command", () => {
  const result = runGate(["--dry-run", "--branch", "feat/local-ci-sandbox", "--sha", "abc123", "--worktree", repoRoot, "--remote", "coordination", "--no-push"], {
    ...process.env,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /branch=feat\/local-ci-sandbox/);
  assert.match(result.stdout, /sha=abc123/);
  assert.match(result.stdout, /remote=coordination/);
  assert.match(result.stdout, /pushBeforeLease=false/);
  assert.match(result.stdout, /localCiCommand=.*local-ci-runner\.mjs.*--candidate "feat\/local-ci-sandbox"/);
});

test("gate-worktree.mjs exits non-zero when DPF_MCP_BEARER_TOKEN is missing", () => {
  const env = { ...process.env, DPF_ALLOW_LOCAL_CI_STUB: "1" };
  delete env.DPF_MCP_BEARER_TOKEN;
  const { dir } = makeTempRepo();
  const result = runGate(["--branch", "feat/x", "--sha", "abc123", "--worktree", dir, "--no-push"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DPF_MCP_BEARER_TOKEN is required/);
});

test("gate-worktree.mjs refuses to run when neither an explicit command, the stub, nor the checked-in Node runner exists", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-node-gate-noscript-"));
  mkdirSync(join(temp, "scripts", "lib"), { recursive: true });
  mkdirSync(join(temp, "apps", "web", "lib", "nonprod"), { recursive: true });
  cpSync(gateScript, join(temp, "scripts", "gate-worktree.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "mcp-client.mjs"), join(temp, "scripts", "lib", "mcp-client.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-failure-summary.mjs"), join(temp, "scripts", "lib", "local-ci-failure-summary.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "sandbox-freshness.mjs"), join(temp, "scripts", "lib", "sandbox-freshness.mjs"));
  // gate-worktree.mjs static-imports these lease-safety modules at load time
  // (BI-52500C0D). Copy them into the temp tree so the refusal path can run
  // instead of dying on ERR_MODULE_NOT_FOUND before the stub guard.
  cpSync(join(repoRoot, "scripts", "lib", "lease-supervisor.mjs"), join(temp, "scripts", "lib", "lease-supervisor.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-sandbox-fence.mjs"), join(temp, "scripts", "lib", "local-sandbox-fence.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-queue-observer.mjs"), join(temp, "scripts", "lib", "local-queue-observer.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-slot-manifest.mjs"), join(temp, "scripts", "lib", "local-ci-slot-manifest.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-gate-state.mjs"), join(temp, "scripts", "lib", "local-ci-gate-state.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-host-pressure.mjs"), join(temp, "scripts", "lib", "local-ci-host-pressure.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "agent-identity.mjs"), join(temp, "scripts", "lib", "agent-identity.mjs"));
  cpSync(
    join(repoRoot, "apps", "web", "lib", "nonprod", "local-ci-slot-resources.json"),
    join(temp, "apps", "web", "lib", "nonprod", "local-ci-slot-resources.json"),
  );

  const { dir } = makeTempRepo();
  const env = { ...process.env, DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread" };
  delete env.DPF_ALLOW_LOCAL_CI_STUB;
  delete env.DPF_LOCAL_CI_COMMAND;

  const result = spawnSync(process.execPath, [join(temp, "scripts", "gate-worktree.mjs"), "--branch", "feat/x", "--sha", "abc123", "--worktree", dir, "--no-push"], { encoding: "utf8", env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to record passing stub evidence/);
});

// ── scripts/gate-worktree.mjs: full lease/evidence sequence ─────────────────

test("gate-worktree.mjs claims, records, and releases in order, and carries evidence fields (BI-166C59F3/BI-76551B2D)", async () => {
  const { dir } = makeTempRepo();
  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-TEST" }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-TEST" }),
    release_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-TEST" }),
  });
  try {
    const result = await runGateAsync(
      ["--branch", "feat/local-ci-sandbox", "--sha", "candidate-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      { ...process.env, DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread", DPF_ALLOW_LOCAL_CI_STUB: "1" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const toolSequence = mcp.calls.map((c) => c.params.name);
    // superviseLeaseRun releases in finally as soon as the child exits, then
    // the gate records evidence (claim → release → record). Holding the lease
    // only for the mutation window is intentional (BI-52500C0D).
    assert.deepEqual(toolSequence, [
      "get_quiescence_status",
      "list_nonprod_environment_leases",
      "claim_nonprod_environment_lease",
      "renew_nonprod_environment_lease",
      "release_nonprod_environment_lease",
      "record_local_integration_result",
    ]);

    const evidenceCall = mcp.calls.find((c) => c.params.name === "record_local_integration_result");
    const claimCall = mcp.calls.find((c) => c.params.name === "claim_nonprod_environment_lease");
    // BI-3A34D7A9: the claim is keyed on the OWNING CLIENT THREAD, which this
    // spawn pins explicitly. It used to be keyed on a per-process observer id,
    // so the key changed every invocation and could not roll a thread's repeated
    // gates together. The observer id still exists — it proves process liveness
    // — but it is no longer what the lease is named after.
    assert.equal(
      claimCall.params.arguments.claimKey,
      "local-ci:contract-thread:candidate-sha",
    );
    assert.equal(claimCall.params.arguments.ownerProvider, "codex");
    assert.equal(claimCall.params.arguments.ownerSessionId, "contract-thread");
    assert.equal(evidenceCall.params.arguments.evidence.leaseId, "NPEL-TEST");
    assert.equal(evidenceCall.params.arguments.evidence.branch, "feat/local-ci-sandbox");
    assert.equal(evidenceCall.params.arguments.evidence.sha, "candidate-sha");
    assert.equal(evidenceCall.params.arguments.evidence.gatePassed, true);
    assert.equal(evidenceCall.params.arguments.evidence.impactedTestRecommendationBi, "BI-A4EC0EA6");
    assert.deepEqual(evidenceCall.params.arguments.evidence.failureSummary, {
      schema: "dpf-local-ci-failure-summary/v1",
      failedTests: [],
      failedChecks: [],
      omittedFailureLineCount: 0,
      truncated: false,
    });
    assert.equal(
      evidenceCall.params.arguments.evidence.fullLogFile,
      join(dir, ".git", "dpf-local-ci-output.log"),
    );
    assert.match(
      readFileSync(evidenceCall.params.arguments.evidence.fullLogFile, "utf8"),
      /sandbox checkout\/build stub: gate passed/,
    );
    assert.deepEqual(evidenceCall.params.arguments.evidence.resilience, {
      publicationMode: "deferred",
      acceptedBaseMode: "local-ref",
      networkTolerance: "offline-capable",
    });

    const state = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(state.gatePassed, true);
    assert.equal(state.branch, "feat/local-ci-sandbox");
    assert.equal(state.sha, "candidate-sha");
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs retries transient quiescence before durable admission", async () => {
  const { dir } = makeTempRepo();
  let quiescenceReads = 0;
  const mcp = await startMockMcp({
    get_quiescence_status: () => {
      quiescenceReads += 1;
      return quiescenceReads === 1
        ? {
          success: true,
          data: {
            level: "draining",
            runId: "QR-TEST",
            writesRefused: true,
            retryAfterSeconds: 0.01,
            drainBlockers: [{ surface: "build-phase", count: 1 }],
          },
        }
        : { success: true, data: { level: "normal", writesRefused: false } };
    },
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-Q" }),
    release_nonprod_environment_lease: () => ({ success: true }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-Q" }),
  });
  try {
    const result = await runGateAsync(
      [
        "--branch", "feat/quiescence-block",
        "--sha", "candidate-sha",
        "--worktree", dir,
        "--no-push",
        "--mcp-url", mcp.url,
        "--poll-seconds", "0.01",
        "--lease-wait-seconds", "2",
      ],
      {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
        DPF_GATE_RETRY_JITTER: "0",
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /portal is draining; retrying governed admission/i);
    assert.deepEqual(mcp.calls.map((call) => call.params.name), [
      "get_quiescence_status",
      "get_quiescence_status",
      "list_nonprod_environment_leases",
      "claim_nonprod_environment_lease",
      "renew_nonprod_environment_lease",
      "release_nonprod_environment_lease",
      "record_local_integration_result",
    ]);
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs reports active lease contention and stale main before expensive work", async () => {
  const { dir, g } = makeTempRepo();
  g(["branch", "feat/topic"]);
  writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
  g(["commit", "-qam", "advance main"]);
  const advancedMain = g(["rev-parse", "HEAD"]);
  g(["update-ref", "refs/remotes/origin/main", advancedMain]);
  g(["checkout", "-q", "feat/topic"]);
  const candidateSha = g(["rev-parse", "HEAD"]);

  const mcp = await startMockMcp({
    list_nonprod_environment_leases: () => ({
      success: true,
      data: {
        leases: [{
          environmentKey: "local-integration-ci",
          leaseId: "NPEL-BUSY",
          status: "active",
        }],
      },
    }),
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-TEST" }),
    release_nonprod_environment_lease: () => ({ success: true }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-TEST" }),
  });
  try {
    const result = await runGateAsync(
      ["--branch", "feat/topic", "--sha", candidateSha, "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      { ...process.env, DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread", DPF_ALLOW_LOCAL_CI_STUB: "1" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /preflight sees 1 active local-integration-ci lease/);
    assert.match(result.stderr, /HEAD is 1 commit\(s\) behind origin\/main/);
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs preserves a green gate for finalize-only evidence replay after quiescence", async () => {
  const { dir } = makeTempRepo();
  let recordAttempts = 0;
  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-PENDING" }),
    release_nonprod_environment_lease: () => ({ success: true }),
    record_local_integration_result: () => {
      recordAttempts += 1;
      return recordAttempts === 1
        ? { success: false, error: "portal_quiescing", data: { retryAfterSeconds: 30 } }
        : { success: true, entityId: "EXT-FINALIZED" };
    },
  });
  try {
    const commonArgs = [
      "--branch", "feat/pending-evidence",
      "--sha", "candidate-sha",
      "--worktree", dir,
      "--no-push",
      "--mcp-url", mcp.url,
    ];
    const env = {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread",
      DPF_ALLOW_LOCAL_CI_STUB: "1",
    };

    const first = await runGateAsync(commonArgs, env);
    assert.equal(first.status, 4, `${first.stdout}\n${first.stderr}`);
    assert.match(first.stderr, /gate passed but evidence recording is pending/i);

    const pendingPath = join(dir, ".git", "dpf-local-ci-pending-evidence.json");
    assert.equal(existsSync(pendingPath), true);
    const pending = JSON.parse(readFileSync(pendingPath, "utf8"));
    assert.equal(pending.branch, "feat/pending-evidence");
    assert.equal(pending.sha, "candidate-sha");
    assert.equal(pending.recordArgs.evidence.gatePassed, true);

    const pendingState = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(pendingState.gatePassed, true);
    assert.equal(pendingState.evidencePending, true);

    const callCountBeforeFinalize = mcp.calls.length;
    const finalized = await runGateAsync(["--finalize-evidence", ...commonArgs], env);
    assert.equal(finalized.status, 0, `${finalized.stdout}\n${finalized.stderr}`);
    assert.match(finalized.stdout, /recorded pending local-CI evidence: EXT-FINALIZED/);
    assert.equal(existsSync(pendingPath), false);

    const finalizeCalls = mcp.calls.slice(callCountBeforeFinalize).map((call) => call.params.name);
    assert.deepEqual(finalizeCalls, ["get_quiescence_status", "record_local_integration_result"]);
    const finalState = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(finalState.gatePassed, true);
    assert.equal(finalState.evidencePending, false);
    assert.equal(finalState.evidenceRecordId, "EXT-FINALIZED");
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs hands the scratch command a clean candidate-gitdir freshness path (BI-5E4EFA22)", async () => {
  const { dir } = makeTempRepo();
  const reportPath = join(dir, ".git", "dpf-sandbox-freshness.json");
  writeFileSync(
    reportPath,
    JSON.stringify({
      schema: "dpf-sandbox-freshness/v1",
      verdict: "sandbox_drift",
      generatedAt: "stale-from-a-prior-run",
      failures: [{ kind: "stale_fixture", message: "must be removed before the gate" }],
      packages: [],
    }),
  );

  const temp = mkdtempSync(join(tmpdir(), "dpf-node-gate-freshness-handoff-"));
  const writerScript = join(temp, "write-freshness.mjs");
  writeFileSync(writerScript, `
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.env.DPF_LOCAL_CI_FRESHNESS_REPORT_FILE;
if (!out) process.exit(40);
if (existsSync(out)) process.exit(41);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  schema: "dpf-sandbox-freshness/v1",
  generatedAt: "fresh-from-this-run",
  verdict: "green",
  failures: [],
  packages: [{
    name: "next",
    lockedVersion: "16.2.11",
    resolvedVersion: "16.2.11"
  }],
  convergence: null,
  handoffPath: out
}) + "\\n");
`);

  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-HANDOFF" }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-HANDOFF" }),
    release_nonprod_environment_lease: () => ({ success: true }),
  });
  try {
    const result = await runGateAsync(
      ["--branch", "feat/freshness-handoff", "--sha", "candidate-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread",
        DPF_LOCAL_CI_COMMAND: `"${process.execPath}" "${writerScript}"`,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.equal(report.generatedAt, "fresh-from-this-run");
    assert.equal(report.handoffPath, reportPath);

    const evidenceCall = mcp.calls.find((c) => c.params.name === "record_local_integration_result");
    assert.equal(evidenceCall.params.arguments.evidence.freshness.verdict, "green");
    assert.deepEqual(evidenceCall.params.arguments.evidence.freshness.packages, [{
      name: "next",
      locked: "16.2.11",
      resolved: "16.2.11",
    }]);
  } finally {
    await mcp.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("gate-worktree.mjs does not clear freshness evidence until it owns the local sandbox fence (BI-5E4EFA22)", async () => {
  const { dir } = makeTempRepo();
  const reportPath = join(dir, ".git", "dpf-sandbox-freshness.json");
  const activeReport = {
    schema: "dpf-sandbox-freshness/v1",
    verdict: "green",
    generatedAt: "active-owner-run",
    failures: [],
    packages: [],
  };
  writeFileSync(reportPath, `${JSON.stringify(activeReport)}\n`);
  writeFileSync(
    join(dir, ".git", "dpf-local-ci-owner-slot-0.json"),
    `${JSON.stringify({
      schema: "dpf-local-sandbox-fence/v1",
      token: "active-owner-token",
      pid: process.pid,
      ownerSessionId: "active-owner",
      branch: "feat/active-owner",
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    })}\n`,
  );

  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-WAITER" }),
    release_nonprod_environment_lease: () => ({ success: true }),
  });
  try {
    const result = await runGateAsync(
      [
        "--branch", "feat/queued-waiter",
        "--sha", "candidate-sha",
        "--worktree", dir,
        "--no-push",
        "--lease-wait-seconds", "0",
        "--mcp-url", mcp.url,
      ],
      {
        ...process.env,
        DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread",
        DPF_ALLOW_LOCAL_CI_STUB: "1",
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sandbox owner process is still live/);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")), activeReport);
    assert.equal(
      mcp.calls.filter((call) => call.params.name === "release_nonprod_environment_lease").length,
      1,
    );
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs records blocked_sandbox_drift (exit 3), not a product failure, when the freshness report is red", async () => {
  const { dir } = makeTempRepo();
  const temp = mkdtempSync(join(tmpdir(), "dpf-node-gate-freshness-drift-"));
  const writerScript = join(temp, "write-freshness-drift.mjs");
  writeFileSync(writerScript, `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const out = process.env.DPF_LOCAL_CI_FRESHNESS_REPORT_FILE;
if (!out) process.exit(40);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
    schema: "dpf-sandbox-freshness/v1",
    verdict: "sandbox_drift",
    failures: [{ kind: "version_drift", message: "next resolves to 16.2.7 but pnpm-lock.yaml requires 16.2.9" }],
    packages: [{ name: "next", lockedVersion: "16.2.9", resolvedVersion: "16.2.7" }],
    convergence: { attempted: true, command: "pnpm install --frozen-lockfile", exitCode: 1 },
}) + "\\n");
process.exit(3);
`);

  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-DRIFT" }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-DRIFT" }),
    release_nonprod_environment_lease: () => ({ success: true }),
  });
  try {
    const result = await runGateAsync(
      ["--branch", "feat/x", "--sha", "abc123", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      { ...process.env, DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread", DPF_LOCAL_CI_COMMAND: `"${process.execPath}" "${writerScript}"` },
    );
    assert.equal(result.status, 3, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /BLOCKED \(sandbox drift\)/);
    assert.match(result.stderr, /not product build evidence/);

    const evidenceCall = mcp.calls.find((c) => c.params.name === "record_local_integration_result");
    assert.equal(evidenceCall.params.arguments.status, "blocked_sandbox_drift");
    assert.equal(evidenceCall.params.arguments.evidence.gatePassed, false);
    assert.equal(evidenceCall.params.arguments.evidence.freshness.verdict, "sandbox_drift");

    const state = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(state.gatePassed, false);
    assert.equal(state.status, "blocked_sandbox_drift");
  } finally {
    await mcp.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("gate-worktree.mjs carries content-addressed local integration metadata into evidence", async () => {
  const { dir } = makeTempRepo();
  const temp = mkdtempSync(join(tmpdir(), "dpf-node-gate-metadata-"));
  const writerScript = join(temp, "write-metadata.mjs");
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
}) + "\\n");
`);

  const mcp = await startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-META" }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-META" }),
    release_nonprod_environment_lease: () => ({ success: true }),
  });
  try {
    const result = await runGateAsync(
      ["--branch", "feat/local-ci-sandbox", "--sha", "candidate-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      { ...process.env, DPF_MCP_BEARER_TOKEN: "dpfmcp_test", DPF_GATE_OWNER_PROVIDER: "codex", DPF_GATE_OWNER_SESSION_ID: "contract-thread", DPF_LOCAL_CI_COMMAND: `"${process.execPath}" "${writerScript}"` },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const evidenceCall = mcp.calls.find((c) => c.params.name === "record_local_integration_result");
    assert.deepEqual(evidenceCall.params.arguments.evidence.content, {
      schemaVersion: 1,
      bi: "BI-76551B2D",
      candidateRef: "feat/local-ci-sandbox",
      candidateSha: "candidate-sha",
      baseRef: "origin/main",
      fetchBase: false,
      baseSha: "base-sha",
    });
  } finally {
    await mcp.close();
  }
});

// ── scripts/local-ci-runner.mjs: dry-run + refusal contract ─────────────────

test("local-ci-runner.mjs --dry-run resolves candidate, root and a non-mutating scratch workspace", () => {
  const result = spawnSync(process.execPath, [runnerScript, "--dry-run", "--candidate", "feat/topic"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /local-ci-runner dry-run/);
  assert.match(result.stdout, /candidate=feat\/topic/);
  assert.match(result.stdout, /workspace=.*\.local-ci-runner/);
  assert.match(result.stdout, /plan=node scripts\/local-integration-ci\.mjs --candidate feat\/topic/);
});

test("local-ci-runner.mjs refuses to gate main or a detached HEAD", () => {
  const onMain = spawnSync(process.execPath, [runnerScript, "--dry-run", "--candidate", "main"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.notEqual(onMain.status, 0);
  assert.match(onMain.stderr, /gate topic branches, not main/);
});
