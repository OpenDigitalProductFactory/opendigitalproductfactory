// Node-native pregate contract (BI-2272D840).
//
// Covers the fallback path scripts/pregate.mjs routes to when a worktree has
// no working native `sh` — scripts/gate-worktree.mjs and
// scripts/local-ci-runner.mjs. Node-path tests deliberately never require
// `sh`; the one routing parity check is explicitly skipped when a native
// POSIX shell is unavailable. The full sh-path contract stays covered by
// tests/release/local-ci-gate-contract.test.mjs.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, cpSync } from "node:fs";
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
// `execPath` is injectable so the spawn-failure contract below can force an
// 'error' event deterministically; every production caller uses the default.
function runGateAsync(args, env, { execPath = process.execPath } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(execPath, [gateScript, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    // Without this, a spawn failure (ENOENT/EACCES, or EAGAIN/EMFILE under heavy
    // CI parallelism) would surface as an uncaughtException that crashes the
    // test subprocess and leaves this Promise forever pending. Reject instead so
    // it lands as a clean test failure.
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// ── test-harness contract: runGateAsync spawn failure (BI-58B02382) ─────────

// Guards the child 'error' listener added in #3910. A ChildProcess that emits
// 'error' with no listener does not fail the awaiting test — Node re-throws it
// as an uncaughtException that kills this whole test file, while the
// 'close'-based Promise stays forever pending. Deleting the listener must break
// a test rather than silently reopen that crash surface, so assert on the
// rejection directly instead of trusting the other cases to notice.
test("runGateAsync rejects (not crashes) when the child cannot be spawned (BI-58B02382)", async () => {
  const missingInterpreter = join(tmpdir(), "dpf-58b02382-no-such-interpreter");
  assert.equal(existsSync(missingInterpreter), false, "fixture path must not exist");

  await assert.rejects(
    runGateAsync(
      ["--dry-run", "--branch", "feat/x", "--worktree", repoRoot],
      { ...process.env },
      { execPath: missingInterpreter },
    ),
    (error) => {
      assert.ok(error instanceof Error, "spawn failure must reject with an Error");
      assert.equal(error.code, "ENOENT");
      assert.equal(error.path, missingInterpreter);
      return true;
    },
  );
});

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
  cpSync(join(repoRoot, "scripts", "lib", "documentation-evidence-lane.mjs"), join(temp, "scripts", "lib", "documentation-evidence-lane.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-integration-ci.mjs"), join(temp, "scripts", "lib", "local-integration-ci.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "host-command-invocation.mjs"), join(temp, "scripts", "lib", "host-command-invocation.mjs"));
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
  cpSync(join(repoRoot, "scripts", "lib", "evidence-validity-policy.mjs"), join(temp, "scripts", "lib", "evidence-validity-policy.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "pregate-console.mjs"), join(temp, "scripts", "lib", "pregate-console.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-convergence-lock.mjs"), join(temp, "scripts", "lib", "local-convergence-lock.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-host-pressure.mjs"), join(temp, "scripts", "lib", "local-ci-host-pressure.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "agent-identity.mjs"), join(temp, "scripts", "lib", "agent-identity.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "local-ci-base-freshness.mjs"), join(temp, "scripts", "lib", "local-ci-base-freshness.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "git-fetch-shared-safe.mjs"), join(temp, "scripts", "lib", "git-fetch-shared-safe.mjs"));
  cpSync(join(repoRoot, "scripts", "lib", "entry-module.mjs"), join(temp, "scripts", "lib", "entry-module.mjs"));
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

// BI-745658D7: the entry guard compares argv[1] against import.meta.url, and
// Node realpath-resolves the ESM entry module. Invoked through a symlinked
// path (macOS tmpdir is /var -> /private/var; the refusal test above runs the
// gate from tmpdir), the naive comparison is false, main() silently never
// runs, and the gate exits 0 with no output — a false pass. This pins the
// guard to run main() regardless of which spelling of the path the caller
// used.
test("gate-worktree.mjs still runs main() when invoked through a symlinked path (BI-745658D7)", (t) => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-node-gate-symlink-"));
  const link = join(temp, "repo-link");
  try {
    // "junction" keeps this runnable on Windows hosts without symlink privilege.
    symlinkSync(repoRoot, link, "junction");
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    t.skip(`cannot create a directory symlink on this host: ${error.code}`);
    return;
  }
  try {
    const result = spawnSync(
      process.execPath,
      [join(link, "scripts", "gate-worktree.mjs"), "--dry-run", "--branch", "feat/x", "--sha", "abc123", "--worktree", repoRoot, "--no-push"],
      { encoding: "utf8", env: { ...process.env } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gate-worktree dry-run/, "main() must run under a symlinked argv[1], not silently exit 0");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
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
      acceptedBaseMode: "unknown",
      networkTolerance: "network-required",
    });

    const state = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(state.gatePassed, true);
    assert.equal(state.branch, "feat/local-ci-sandbox");
    assert.equal(state.sha, "candidate-sha");
    assert.equal(state.leaseExpiresAt, evidenceCall.params.arguments.evidence.expiresAt);
    assert.equal(state.expiresAt, state.evidenceValidity.expiresAt);
    assert.ok(Date.parse(state.expiresAt) > Date.parse(state.leaseExpiresAt));
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
    assert.equal(finalState.leaseExpiresAt, pending.expiresAt);
    assert.ok(
      Date.parse(finalState.expiresAt) >= Date.parse(finalState.recordedAt) + 23 * 60 * 60_000,
      "finalized PASS evidence must remain publishable beyond the short lease authority",
    );
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs finalizes an exact legacy published PASS without rerunning CI", async () => {
  const { dir } = makeTempRepo();
  const gitDir = join(dir, ".git");
  const branch = "feat/legacy-pass";
  const sha = "candidate-sha";
  const recordedAt = new Date(Date.now() - 60_000).toISOString();
  const leaseExpiresAt = new Date(Date.now() - 30_000).toISOString();
  writeFileSync(join(gitDir, "dpf-local-ci-gate.json"), JSON.stringify({
    branch,
    sha,
    gatePassed: true,
    status: "passed",
    leaseId: "NPEL-LEGACY",
    evidenceRecordId: "EXT-LEGACY",
    evidencePending: false,
    expiresAt: leaseExpiresAt,
    recordedAt,
    leaseEvents: [],
  }));
  writeFileSync(join(gitDir, "dpf-local-ci-metadata.json"), JSON.stringify({ candidateSha: sha }));
  const mcp = await startMockMcp({});
  try {
    const result = await runGateAsync([
      "--finalize-evidence",
      "--branch", branch,
      "--sha", sha,
      "--worktree", dir,
      "--no-push",
      "--mcp-url", mcp.url,
    ], {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_GATE_OWNER_PROVIDER: "codex",
      DPF_GATE_OWNER_SESSION_ID: "contract-thread",
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /finalized existing local-CI evidence: EXT-LEGACY/);
    assert.deepEqual(mcp.calls.map((call) => call.params.name), ["get_quiescence_status"]);
    const state = JSON.parse(readFileSync(join(gitDir, "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(state.leaseExpiresAt, leaseExpiresAt);
    assert.equal(state.evidenceRecordId, "EXT-LEGACY");
    assert.equal(
      state.expiresAt,
      new Date(Date.parse(recordedAt) + 24 * 60 * 60_000).toISOString(),
      "legacy finalization is anchored to the original PASS, not the finalization attempt",
    );

    const repeated = await runGateAsync([
      "--finalize-evidence",
      "--branch", branch,
      "--sha", sha,
      "--worktree", dir,
      "--no-push",
      "--mcp-url", mcp.url,
    ], {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_GATE_OWNER_PROVIDER: "codex",
      DPF_GATE_OWNER_SESSION_ID: "contract-thread",
    });
    assert.equal(repeated.status, 0, `${repeated.stdout}\n${repeated.stderr}`);
    const repeatedState = JSON.parse(readFileSync(join(gitDir, "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(repeatedState.expiresAt, state.expiresAt, "repeated finalization cannot extend evidence authority");
  } finally {
    await mcp.close();
  }
});

test("gate-worktree.mjs refuses legacy PASS finalization when metadata is not exact", async () => {
  const { dir } = makeTempRepo();
  const gitDir = join(dir, ".git");
  writeFileSync(join(gitDir, "dpf-local-ci-gate.json"), JSON.stringify({
    branch: "feat/legacy-pass",
    sha: "candidate-sha",
    gatePassed: true,
    status: "passed",
    leaseId: "NPEL-LEGACY",
    evidenceRecordId: "EXT-LEGACY",
    evidencePending: false,
    expiresAt: new Date(Date.now() - 30_000).toISOString(),
    recordedAt: new Date(Date.now() - 60_000).toISOString(),
    leaseEvents: [],
  }));
  writeFileSync(join(gitDir, "dpf-local-ci-metadata.json"), JSON.stringify({ candidateSha: "other-sha" }));
  const mcp = await startMockMcp({});
  try {
    const result = await runGateAsync([
      "--finalize-evidence",
      "--branch", "feat/legacy-pass",
      "--sha", "candidate-sha",
      "--worktree", dir,
      "--no-push",
      "--mcp-url", mcp.url,
    ], {
      ...process.env,
      DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
      DPF_GATE_OWNER_PROVIDER: "codex",
      DPF_GATE_OWNER_SESSION_ID: "contract-thread",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no exact published PASS is available to finalize/);
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
  schemaVersion: 2,
  bi: "BI-76551B2D",
  candidateRef: "feat/local-ci-sandbox",
  candidateSha: "candidate-sha",
  baseRef: "origin/main",
  fetchBase: true,
  baseSha: "base-sha",
  baseFreshness: {
    status: "remote-current",
    resolvedAt: "2026-07-31T02:00:00.000Z",
    fetchMode: "full-fetch"
  }
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
      schemaVersion: 2,
      bi: "BI-76551B2D",
      candidateRef: "feat/local-ci-sandbox",
      candidateSha: "candidate-sha",
      baseRef: "origin/main",
      fetchBase: true,
      baseSha: "base-sha",
      baseFreshness: {
        status: "remote-current",
        resolvedAt: "2026-07-31T02:00:00.000Z",
        fetchMode: "full-fetch",
      },
    });
    assert.deepEqual(evidenceCall.params.arguments.evidence.resilience, {
      publicationMode: "deferred",
      acceptedBaseMode: "remote-current",
      networkTolerance: "network-required",
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

// ── BI-B1065D41 Phase 1: the gate must be READABLE and VERDICTABLE ───────────
//
// These are functional, not structural: they run the real gate against a real
// (loud) child command and assert on what actually reaches stdout. The old
// behaviour mirrored every child line, producing ~28,000 lines for one run —
// which is what made piping to `head` the rational response, and that pipe is
// what SIGPIPE-killed runs mid-install.

/** Env for a gate run whose child command prints `lines` lines. */
function loudGateEnv(mcpUrl, lines, extra = {}) {
  return {
    ...process.env,
    DPF_MCP_BEARER_TOKEN: "dpfmcp_test",
    DPF_GATE_OWNER_PROVIDER: "codex",
    DPF_GATE_OWNER_SESSION_ID: "contract-thread",
    DPF_LOCAL_CI_COMMAND: `${JSON.stringify(process.execPath)} -e "for(let i=0;i<${lines};i++)console.log('sandbox build step '+i)"`,
    ...extra,
  };
}

async function passingMcp() {
  return startMockMcp({
    claim_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-LOUD" }),
    record_local_integration_result: () => ({ success: true, entityId: "EXT-LOUD" }),
    release_nonprod_environment_lease: () => ({ success: true, entityId: "NPEL-LOUD" }),
  });
}

test("gate stdout stays bounded while the full transcript lands in the log (BI-B1065D41)", async () => {
  const { dir } = makeTempRepo();
  const mcp = await passingMcp();
  try {
    const result = await runGateAsync(
      ["--branch", "feat/loud", "--sha", "loud-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      loudGateEnv(mcp.url, 20_000),
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const stdoutLines = result.stdout.split("\n").filter((l) => l.trim() !== "");
    assert.ok(
      stdoutLines.length <= 40,
      `stdout must stay readable; got ${stdoutLines.length} lines:\n${result.stdout.slice(0, 2000)}`,
    );
    assert.equal(stdoutLines.at(-1), "gate passed", "the documented ^gate passed anchor must be the last line");
    assert.ok(
      !result.stdout.includes("sandbox build step 5000"),
      "the child transcript must not be mirrored to stdout",
    );

    // …but it is not LOST: the full log holds every line, and stdout names it.
    const logFile = join(dir, ".git", "dpf-local-ci-output.log");
    assert.ok(result.stdout.includes(logFile), "stdout must name the full log path");
    const logLines = readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim() !== "");
    assert.equal(logLines.length, 20_000, "the full transcript must be persisted");
  } finally {
    await mcp.close();
  }
});

test("DPF_PREGATE_VERBOSE=1 restores the full mirror (BI-B1065D41)", async () => {
  const { dir } = makeTempRepo();
  const mcp = await passingMcp();
  try {
    const result = await runGateAsync(
      ["--branch", "feat/verbose", "--sha", "verbose-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      loudGateEnv(mcp.url, 200, { DPF_PREGATE_VERBOSE: "1" }),
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes("sandbox build step 150"), "verbose mode must mirror the child");
  } finally {
    await mcp.close();
  }
});

test("a piped gate completes and still records a gate record (BI-B1065D41)", async () => {
  // The literal trap: three runs were SIGPIPE-killed mid-install by `| head`.
  // A closed reader must degrade the OUTPUT, never terminate the run — the run
  // holds a shared lease, so dying mid-flight wedges the queue for everyone.
  const { dir } = makeTempRepo();
  const mcp = await passingMcp();
  try {
    const status = await new Promise((resolve, reject) => {
      const gate = spawn(process.execPath, [
        gateScript,
        "--branch", "feat/piped", "--sha", "piped-sha", "--worktree", dir, "--no-push", "--mcp-url", mcp.url,
      ], { env: loudGateEnv(mcp.url, 20_000, { DPF_PREGATE_VERBOSE: "1" }), stdio: ["ignore", "pipe", "ignore"] });
      gate.on("error", reject);
      let seen = 0;
      gate.stdout.on("data", (chunk) => {
        seen += String(chunk).split("\n").length;
        // Emulate `| head -5`: stop reading and destroy the pipe early.
        if (seen >= 5 && !gate.stdout.destroyed) gate.stdout.destroy();
      });
      gate.on("close", resolve);
    });

    assert.equal(status, 0, "a closed stdout reader must not kill the gate");
    const state = JSON.parse(readFileSync(join(dir, ".git", "dpf-local-ci-gate.json"), "utf8"));
    assert.equal(state.gatePassed, true, "the gate record must still be written");
    assert.equal(state.sha, "piped-sha");
    assert.ok(
      mcp.calls.some((c) => c.params.name === "record_local_integration_result"),
      "evidence must still be recorded when the reader went away",
    );
  } finally {
    await mcp.close();
  }
});

// ── BI-B1065D41 Phase 2: pregate:status is the authoritative verdict ─────────

const statusScript = join(repoRoot, "scripts", "pregate-status.mjs");

function runStatus(cwd) {
  const r = spawnSync(process.execPath, [statusScript, "--json"], { cwd, encoding: "utf8" });
  return { status: r.status, report: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

test("pregate:status reports NO-RECORD (exit 1) for a worktree that never gated", () => {
  const { dir } = makeTempRepo();
  const out = runStatus(dir);
  assert.equal(out.status, 1, "no record must never exit 0");
  assert.equal(out.report.verdict, "NO-RECORD");
});

test("pregate:status reports PASS for the gated SHA, then STALE once HEAD moves", async () => {
  const { dir, g } = makeTempRepo();
  const headSha = g(["rev-parse", "HEAD"]);
  const branch = g(["rev-parse", "--abbrev-ref", "HEAD"]);
  const mcp = await passingMcp();
  try {
    const gate = await runGateAsync(
      ["--branch", branch, "--sha", headSha, "--worktree", dir, "--no-push", "--mcp-url", mcp.url],
      loudGateEnv(mcp.url, 50),
    );
    assert.equal(gate.status, 0, `${gate.stdout}\n${gate.stderr}`);

    const passed = runStatus(dir);
    assert.equal(passed.status, 0, `expected exit 0 for a gated HEAD: ${passed.report?.reason}`);
    assert.equal(passed.report.verdict, "PASS");
    assert.equal(passed.report.boundSha, headSha);
    assert.equal(passed.report.headSha, headSha);

    // The whole point of the command: gate once, commit again, and the verdict
    // flips WITHOUT re-reading a log or trusting the previous run's exit code.
    writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
    g(["add", "."]);
    g(["commit", "-q", "-m", "second"]);

    const stale = runStatus(dir);
    assert.equal(stale.status, 1, "a moved HEAD must never exit 0");
    assert.equal(stale.report.verdict, "STALE");
    assert.equal(stale.report.staleness, "head-moved");
    assert.equal(stale.report.boundSha, headSha);
    assert.notEqual(stale.report.headSha, headSha);
  } finally {
    await mcp.close();
  }
});
