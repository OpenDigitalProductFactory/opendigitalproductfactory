import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import * as pregate from "./pregate.mjs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { readEarlyQuiescenceStatus, readQuiescenceStatus, quiescenceBlocksWrites } from "./lib/gate-quiescence.mjs";
import { isolatedGateFixtureEnvironment, makeTempWorktree, startGateFixtureMcp } from "./lib/gate-worktree-test-fixtures.mjs";
import { exitCodeForVerdict } from "./lib/pregate-status.mjs";

test("wrapped pregate stops only when stdout is captured and no escape hatch is set", () => {
  const captured = { stdoutIsTTY: false, env: {}, args: [] };
  assert.match(pregate.wrappedForegroundReason(captured), /sole foreground command/);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, stdoutIsTTY: true }), null);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, env: { DPF_PREGATE_ALLOW_CAPTURE: "1" } }), null);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, env: { CI: "true" } }), null);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, env: { GITHUB_ACTIONS: "true" } }), null);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, args: ["--dry-run"] }), null);
  assert.equal(pregate.wrappedForegroundReason({ ...captured, args: ["--help"] }), null);
});

test("parent preflight never advertises environment-limited checks as passed", async () => {
  let output = "";
  const result = await pregate.runHostPreflight({ env: {}, readStatusImpl: async () => ({level:"normal"}),
    spawnSyncImpl: () => ({status:0,stdout:'DPF_HOST_PREFLIGHT_RESULT={"status":"inconclusive"}\n'}),
    stdout: text => { output += text; }, stderr: () => {} });
  assert.equal(result, 0, "canonical CI still enforces environment-skipped guards");
  assert.doesNotMatch(output, /preflight passed/);
  assert.match(output, /inconclusive/i);
});

test("parent preflight timeout remains unrun even if the child exits zero", async () => {
  const result = await pregate.runHostPreflight({ env: {}, readStatusImpl: async () => ({level:"normal"}),
    spawnSyncImpl: () => ({status:0,deadlineExceeded:true,stdout:""}), stdout: () => {}, stderr: () => {} });
  assert.equal(result, 88);
});

test("parent preflight recording error remains unrun even if the child exits zero", async () => {
  let output = "";
  let diagnostics = "";
  const result = await pregate.runHostPreflight({ env: {}, readStatusImpl: async () => ({level:"normal"}),
    runObservedImpl: async () => ({status:0,error:new Error("progress recording failed"),
      outputTail:'DPF_HOST_PREFLIGHT_RESULT={"status":"passed"}\n'}),
    stdout: text => {output += text;}, stderr: text => {diagnostics += text;} });
  assert.equal(result,88);
  assert.doesNotMatch(output,/preflight passed/);
  assert.match(diagnostics,/could not RUN/);
});

test("observed parent preflight passes cancellation and cleans its listeners", async () => {
  const before = process.listenerCount("SIGINT");
  let output = "";
  const result = await pregate.runHostPreflight({ env: {}, readStatusImpl: async () => ({level:"normal"}),
    runObservedImpl: async ({signal,shell}) => {
      assert.equal(signal.aborted,false);
      assert.equal(shell,false);
      return {status:0,outputTail:'DPF_HOST_PREFLIGHT_RESULT={"status":"passed"}\n'};
    }, stdout: text => {output += text;}, stderr: () => {} });
  assert.equal(result,0);
  assert.match(output,/preflight passed/);
  assert.equal(process.listenerCount("SIGINT"),before);
});

import {
  EXIT_DURABLE_QUEUE_WAIT,
  WINDOWS_WRAPPER_TERMINATED_STATUS,
  createQueuedGateRevivalWindow,
  gateArgsForQueuedRevivalWindow,
  runGateWithQueuedRevival,
  detectWorkingShell,
  recoverInterruptedGate,
  recoverInterruptedGateState,
  resolvePregateGateContext,
  reviveInterruptedQueuedGateState,
  shouldReuseExistingPass,
  shouldUseShell,
  stripForceRerunFlag,
} from "./pregate.mjs";

test("confirmed quiescence parks before any expensive host preflight", async () => {
  let launches = 0;
  let output = "";
  assert.equal(typeof pregate.runHostPreflight, "function", "preflight must own the early read ordering");
  const status = await pregate.runHostPreflight({
    args: [], env: {},
    readStatusImpl: async () => ({ level: "draining", runId: "upgrade-fixture", retryAfterSeconds: 30 }),
    spawnSyncImpl: () => { launches++; return { status: 0 }; },
    stdout: () => {}, stderr: (text) => { output += text; },
  });
  assert.equal(status, 75);
  assert.equal(launches, 0);
  assert.equal(JSON.parse(output).code, "local_ci_quiescence_wait");
});

test("normal and unknown status retain preflight execution and its real exit code", async () => {
  for (const status of [null, {}, { level: "unknown" }, { level: "normal" }]) {
    const calls = [];
    const result = await pregate.runHostPreflight({ args: [], env: {},
      readStatusImpl: async () => { calls.push("read"); return status; },
      spawnSyncImpl: () => { calls.push("preflight"); return { status: 9, stderr: "guard failed" }; },
      stdout: () => {}, stderr: () => {},
    });
    assert.equal(result, 9);
    assert.deepEqual(calls, ["read", "preflight"]);
  }
  assert.equal(quiescenceBlocksWrites({ level: "swapping" }), true);
  assert.equal(quiescenceBlocksWrites({ level: "normal", writesRefused: true }), true);
  assert.equal(quiescenceBlocksWrites({ level: "unexpected", writesRefused: false }), false);
});

test("record-exempt and audited skip paths do not probe or start preflight", async () => {
  for (const args of [["--dry-run"], ["--finalize-evidence"], ["--help"], ["-h"], []]) {
    const env = args.length ? {} : { DPF_SKIP_PREGATE_PREFLIGHT_REASON: "fixture-only" };
    assert.equal(await pregate.runHostPreflight({ args, env,
      readStatusImpl: () => assert.fail("must not probe"),
      spawnSyncImpl: () => assert.fail("must not run preflight"),
      stdout: () => {}, stderr: () => {},
    }), 0);
  }
});

test("malformed, denied, and transport-failed reads are inconclusive without leaking details", async () => {
  for (const response of [{ success: false, error: "insufficient_token_scope" },
    { success: true, data: {} }, { success: true, data: { level: "future-value" } }, null]) {
    let warning = "";
    assert.equal(await readQuiescenceStatus({ mcpCallImpl: async () => response,
      warn: (text) => { warning += text; } }), null);
    assert.match(warning, /inconclusive/);
  }
  let warning = "";
  assert.equal(await readQuiescenceStatus({ mcpCallImpl: async () => { throw Error("secret-fixture"); },
    warn: (text) => { warning += text; } }), null);
  assert.doesNotMatch(warning, /secret-fixture/);
});

test("early native probe honors explicit and configured endpoints with bounded reads", async () => {
  for (const explicit of [true, false]) {
    const env = { DPF_MCP_URL: "https://configured.example/api/mcp/v1" };
    const args = explicit ? ["--mcp-url=https://explicit.example/api/mcp/v1"] : [];
    const expected = explicit ? "https://explicit.example/api/mcp/v1" : env.DPF_MCP_URL;
    const result = await readEarlyQuiescenceStatus({ args, env,
      resolveCredentialImpl: (options) => { assert.equal(options.mcpUrl, expected); return { bearer: "fake-fixture" }; },
      mcpCallImpl: async (tool, payload, options) => {
        assert.equal(tool, "get_quiescence_status");
        assert.deepEqual(payload, {});
        assert.equal(options.mcpUrl, expected);
        assert.equal(options.timeoutMs, 2500);
        assert.equal(options.allowNonLoopbackEndpoint, explicit);
        return { success: true, data: { level: "normal" } };
      },
    });
    assert.deepEqual(result, { level: "normal" });
  }
  let warning = "";
  assert.equal(await readEarlyQuiescenceStatus({ resolveCredentialImpl: () => { throw Error("credential-secret"); },
    warn: (text) => { warning += text; } }), null);
  assert.match(warning, /unavailable/);
  assert.doesNotMatch(warning, /credential-secret/);
});

test("real mock-only MCP drain read performs no preflight or write call", async (t) => {
  const tools = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      tools.push(request.params.name);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
        content: [{ type: "text", text: JSON.stringify({ success: true, data: { level: "draining", retryAfterSeconds: 30 } }) }],
      } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await pregate.runHostPreflight({ args: [], env: {},
    readStatusImpl: () => readEarlyQuiescenceStatus({
      env: { DPF_MCP_URL: `http://127.0.0.1:${server.address().port}/api/mcp/v1` },
      resolveCredentialImpl: () => ({ bearer: "mock-only-fixture" }),
    }),
    spawnSyncImpl: () => assert.fail("expensive preflight must not start"),
    stdout: () => {}, stderr: () => {},
  });
  assert.equal(result, 75);
  assert.deepEqual(tools, ["get_quiescence_status"]);
});

test("entry ordering retains PASS reuse before early check and late governed admission", () => {
  const wrapper = readFileSync(new URL("./pregate.mjs", import.meta.url), "utf8");
  const main = wrapper.slice(wrapper.indexOf("async function main()"), wrapper.indexOf("export async function runHostPreflight"));
  assert.ok(main.indexOf("if (reuse.reuse)") < main.indexOf("await runHostPreflight"));
  assert.ok(main.indexOf("await runHostPreflight") < main.indexOf("await runGateWithQueuedRevival"));
  assert.match(main, /if \(preflightStatus !== 0\) process.exit\(preflightStatus\)/);
  const gate = readFileSync(new URL("./gate-worktree.mjs", import.meta.url), "utf8");
  assert.match(gate, /await readQuiescenceStatus/);
  assert.match(gate, /claim_nonprod_environment_lease/);
});

test("pregate recovery uses the bare common directory as the canonical root", () => {
  const fixtureRoot = resolve(".pregate-bare-layout");
  const worktreePath = join(fixtureRoot, "worktrees", "candidate");
  const gitCommonDir = join(fixtureRoot, ".opendigitalproductfactory.git");
  const candidateGitDir = join(gitCommonDir, "worktrees", "candidate");
  const responses = new Map([
    ["rev-parse --show-toplevel", worktreePath],
    ["rev-parse --abbrev-ref HEAD", "fix/local-ci-scratch-identity"],
    ["rev-parse HEAD", "a".repeat(40)],
    ["rev-parse --git-common-dir", gitCommonDir],
    ["rev-parse --git-path dpf-local-ci-gate.json", join(candidateGitDir, "dpf-local-ci-gate.json")],
  ]);
  const spawnSyncImpl = (_command, args) => ({
    status: 0,
    error: null,
    stdout: `${responses.get(args.join(" ")) ?? ""}\n`,
  });

  const context = resolvePregateGateContext({ cwd: worktreePath, spawnSyncImpl });

  assert.equal(context.gitCommonDir, gitCommonDir);
  assert.equal(context.rootClone, gitCommonDir);
  assert.equal(context.candidateGitDir, candidateGitDir);
});

test("queued gate revivals share the original bounded admission deadline", () => {
  const startedAtMs = Date.parse("2026-08-12T03:00:00.000Z");
  const window = createQueuedGateRevivalWindow({
    args: ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "7200"],
    env: {},
    nowMs: startedAtMs,
  });

  assert.equal(window.deadlineMs, startedAtMs + 7_200_000);
  assert.deepEqual(
    gateArgsForQueuedRevivalWindow({
      args: ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "7200"],
      window,
      nowMs: startedAtMs + 1_800_123,
    }),
    ["--branch", "fix/local-ci-survival", "--lease-wait-seconds", "5400"],
  );
  assert.deepEqual(
    gateArgsForQueuedRevivalWindow({
      args: ["--branch", "fix/local-ci-survival"],
      window,
      nowMs: window.deadlineMs,
    }),
    null,
  );
});

test("queued gate survival is bounded by time rather than an arbitrary revival count", async () => {
  const wrapperExit = { status: WINDOWS_WRAPPER_TERMINATED_STATUS, signal: null };
  const results = Array.from({ length: 7 }, () => wrapperExit).concat({ status: 0, signal: null });
  const invocations = [];
  const revivals = [];
  let recovered = false;
  let nowMs = Date.parse("2026-08-12T03:00:00.000Z");

  const outcome = await runGateWithQueuedRevival({
    args: ["--lease-wait-seconds", "7200"],
    useShell: false,
    now: () => nowMs,
    runGateImpl: async (_command, args) => {
      invocations.push(args);
      nowMs += 300_000;
      return results.shift();
    },
    reviveInterruptedQueuedGateImpl: async ({ result }) => {
      revivals.push(result.status);
      return { revived: true, leaseId: "NPEL-STABLE" };
    },
    recoverInterruptedGateImpl: async () => {
      recovered = true;
    },
    stderr: { write() {} },
  });

  assert.equal(outcome.result.status, 0);
  assert.equal(outcome.queuedRevivals, 7);
  assert.equal(invocations.length, 8);
  assert.equal(revivals.length, 7);
  assert.equal(recovered, false);
  assert.equal(invocations.at(-1).at(-1), "5100");
});

test("explicit foreground cancellation waits for close and recovery without reviving queued work", async () => {
  const signals = new EventEmitter();
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.kill = () => assert.fail("one Windows console cancellation must not be forwarded as hard kill");
  let reviveCalls = 0, recovered = false;
  const result = await runGateWithQueuedRevival({ signalSource: signals,
    runGateImpl: (command, args, options) => {
      const pending = pregate.runForegroundGate(command, args, { ...options, platform: "win32",
        spawnImpl: () => child });
      signals.emit("SIGINT");
      assert.equal(options.signal.aborted, true);
      setImmediate(() => { child.exitCode = 87; child.emit("close", 87, null); });
      return pending;
    },
    reviveInterruptedQueuedGateImpl: async () => { reviveCalls++; return { revived: true }; },
    recoverInterruptedGateImpl: async ({ result: closed }) => {
      assert.equal(closed.status, 87);
      assert.equal(signals.listenerCount("SIGINT"), 1);
      signals.emit("SIGINT"); // Repeated cancellation cannot kill recovery.
      await new Promise(resolve => setImmediate(resolve)); recovered = true;
    }, stderr: { write() {} } });
  assert.equal(result.result.status, 87); assert.equal(recovered, true);
  assert.equal(reviveCalls, 0); assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

for (const observedExit of [null, 87]) test("foreground cancellation requires close even with exit " + observedExit,
  { timeout: 1000 }, async () => {
  const signals = new EventEmitter(); const child = new EventEmitter();
  child.exitCode = observedExit; child.signalCode = null;
  let killed = 0;
  child.kill = signal => { assert.equal(signal, "SIGKILL"); killed++; return true; };
  const result = await runGateWithQueuedRevival({ signalSource: signals,
    runGateImpl: (command, args, options) => {
      const pending = pregate.runForegroundGate(command, args, { ...options, platform: "win32",
        spawnImpl: () => child, cancellationGraceMs: 1, closeGraceMs: 1 });
      signals.emit("SIGINT"); return pending;
    }, recoverInterruptedGateImpl: async () => assert.fail("unobserved closure cannot release a running owner"),
    stderr: { write() {} } });
  assert.equal(killed, observedExit === null ? 1 : 0); assert.match(result.result.error.message, /closure|did not close/);
  assert.equal(signals.listenerCount("SIGINT"), 0);
});

function shellProbe(status = 0) {
  return () => ({
    status,
    error: null,
    stdout: status === 0 ? "/tmp/worktree\n" : "",
  });
}

test("pregate routes to the canonical Node gate by default even when sh works", () => {
  assert.equal(detectWorkingShell({ spawnSyncImpl: shellProbe(0) }), true);
  assert.equal(shouldUseShell({ env: {}, spawnSyncImpl: shellProbe(0) }), false);
});

test("pregate shell route is explicit and still requires a working shell", () => {
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1" },
    spawnSyncImpl: shellProbe(0),
  }), true);
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1" },
    spawnSyncImpl: shellProbe(1),
  }), false);
  assert.equal(shouldUseShell({
    env: { DPF_PREGATE_FORCE_SH: "1", DPF_PREGATE_FORCE_NODE: "1" },
    spawnSyncImpl: shellProbe(0),
  }), false);
});

test("pregate recovery releases an interrupted running gate and marks it INFRASTRUCTURE, not failed (BI-D088D06D)", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-descendant-fence",
      sha: "a".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-INTERRUPTED",
      evidenceRecordId: "",
      status: "running",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "admitted", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
    },
    branch: "fix/local-ci-descendant-fence",
    sha: "a".repeat(40),
    childStatus: 1,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:01:00.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.releaseSucceeded, true);
  assert.deepEqual(calls, [{
    tool: "release_nonprod_environment_lease",
    args: { leaseId: "NPEL-INTERRUPTED" },
  }]);
  // The wrapper dying before a terminal state never graded the diff, so it must
  // not write a status that reads as a grade. `blocked_*` is the vocabulary
  // pregate-status classifies as INCONCLUSIVE.
  assert.equal(written.status, "blocked_wrapper_exited");
  assert.match(written.status, /^blocked_/);
  assert.notEqual(written.status, "failed");
  assert.equal(written.gatePassed, false);
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_gate_recovery");
  assert.equal(written.recovery.reason, "gate-wrapper-exited-before-terminal-state");
});

test("surviving pregate recovery atomically persists an inconclusive filesystem record", async t => {
  // This verifies the existing reconciler independently; it cannot stand in for
  // the real console test or prove that a reconciler survives whole-chain loss.
  const worktree = makeTempWorktree();
  const evidence = mkdtempSync(join(tmpdir(), "dpf-recovery-acceptance-"));
  const git = args => spawnSync("git", args, { cwd: worktree, encoding: "utf8" }).stdout.trim();
  const branch = git(["branch", "--show-current"]);
  const sha = git(["rev-parse", "HEAD"]);
  const stateFile = join(worktree, ".git/dpf-local-ci-gate.json");
  const state = { branch, sha, status: "running", gatePassed: false, leaseId: "NPEL-FILESYSTEM-FIXTURE",
    evidenceRecordId: "", evidencePending: false, expiresAt: new Date(Date.now() + 60000).toISOString(),
    leaseEvents: [{ type: "admitted", at: new Date().toISOString() }] };
  writeFileSync(stateFile, JSON.stringify(state));
  const mcp = await startGateFixtureMcp(call => {
    assert.equal(call.name, "release_nonprod_environment_lease");
    assert.deepEqual(call.args, { leaseId: state.leaseId });
    return { success: true };
  });
  try {
    const result = await recoverInterruptedGateState({ stateFile, state, branch, sha,
      childStatus: WINDOWS_WRAPPER_TERMINATED_STATUS, mcpUrl: mcp.url, bearerToken: "test-token" });
    assert.equal(result.recovered, true); assert.equal(result.releaseSucceeded, true);
    const saved = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(saved.status, "blocked_wrapper_exited");
    assert.equal(saved.gatePassed, false); assert.equal(saved.evidenceRecordId, "");
    assert.equal(saved.leaseEvents.at(-1).type, "pregate_interrupted_gate_recovery");
    assert.equal(mcp.calls.length, 1);
    const status = spawnSync(process.execPath, [resolve("scripts/pregate-status.mjs"), "--json"], {
      cwd: worktree, env: isolatedGateFixtureEnvironment(evidence, {}), encoding: "utf8" });
    const projection = JSON.parse(status.stdout);
    assert.equal(status.status, exitCodeForVerdict("INCONCLUSIVE"));
    assert.equal(projection.verdict, "INCONCLUSIVE");
    assert.equal(projection.headSha, sha); assert.equal(projection.boundSha, sha);
    assert.equal(projection.gateStatus, saved.status);
    // Terminal state is idempotent and cannot release again or become a pass.
    const replay = await recoverInterruptedGateState({ stateFile, state: saved, branch, sha,
      mcpUrl: mcp.url, bearerToken: "test-token" });
    assert.equal(replay.recovered, false); assert.equal(mcp.calls.length, 1);
    writeFileSync(join(evidence, "projection.json"), status.stdout);
  } finally { await mcp.close(); t.diagnostic("Filesystem recovery evidence retained: " + evidence); }
});

test("pregate recovery releases an interrupted queued gate as INFRASTRUCTURE, not failed (BI-D088D06D)", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-queued-recovery",
      sha: "c".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-QUEUED",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
      queueObserver: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
        pid: 12345,
        ownerSessionId: "test-owner",
      },
    },
    branch: "fix/local-ci-queued-recovery",
    sha: "c".repeat(40),
    childStatus: 4294967295,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    releaseLocalQueueObserverImpl: (args) => {
      calls.push({ tool: "releaseLocalQueueObserver", args });
      return { status: "released" };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:02:00.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.releaseSucceeded, true);
  assert.deepEqual(calls, [
    {
      tool: "release_nonprod_environment_lease",
      args: { leaseId: "NPEL-QUEUED" },
    },
    {
      tool: "releaseLocalQueueObserver",
      args: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
      },
    },
  ]);
  assert.equal(written.status, "blocked_wrapper_exited");
  assert.notEqual(written.status, "failed");
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_gate_recovery");
  assert.equal(written.recovery.childStatus, 4294967295);
  assert.equal(written.recovery.queueObserverReleaseStatus, "released");
});

test("pregate recovery falls back to dead observer cleanup by gate identity", async () => {
  const calls = [];
  let written = null;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-fallback-cleanup",
      sha: "d".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-FALLBACK",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
    },
    branch: "fix/local-ci-fallback-cleanup",
    sha: "d".repeat(40),
    childStatus: 1,
    bearerToken: "test-token",
    mcpCallImpl: async (tool, args) => {
      calls.push({ tool, args });
      return { success: true };
    },
    releaseDeadLocalQueueObserversForGateImpl: (args) => {
      calls.push({ tool: "releaseDeadLocalQueueObserversForGate", args });
      return [{
        observerToken: "fallback-token",
        pid: 12345,
        branch: args.branch,
        sha: args.sha,
        releaseStatus: "released",
      }];
    },
    queueObserverFallbackDirectory: "/tmp/dpf-local-ci-queue-observers",
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:02:30.000Z",
  });

  assert.equal(recovered.recovered, true);
  assert.deepEqual(calls, [
    {
      tool: "release_nonprod_environment_lease",
      args: { leaseId: "NPEL-FALLBACK" },
    },
    {
      tool: "releaseDeadLocalQueueObserversForGate",
      args: {
        directory: "/tmp/dpf-local-ci-queue-observers",
        branch: "fix/local-ci-fallback-cleanup",
        sha: "d".repeat(40),
      },
    },
  ]);
  assert.equal(written.recovery.queueObserverReleaseStatus, "fallback-released:1");
  assert.equal(written.recovery.queueObserverFallbackReleases.length, 1);
});

test("pregate revival preserves an interrupted queued gate lease", async () => {
  const calls = [];
  let written = null;
  const revived = await reviveInterruptedQueuedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-queued-revival",
      sha: "e".repeat(40),
      gatePassed: false,
      leaseId: "NPEL-QUEUED-REVIVE",
      evidenceRecordId: "",
      status: "queued",
      expiresAt: "2026-07-30T06:00:00.000Z",
      leaseEvents: [{ type: "queued", at: "2026-07-30T05:00:00.000Z" }],
      evidencePending: false,
      queueObserver: {
        path: "/tmp/dpf-local-ci-observer.json",
        token: "observer-token",
        pid: 12345,
        ownerSessionId: "test-owner",
      },
    },
    branch: "fix/local-ci-queued-revival",
    sha: "e".repeat(40),
    childStatus: WINDOWS_WRAPPER_TERMINATED_STATUS,
    releaseLocalQueueObserverImpl: (args) => {
      calls.push({ tool: "releaseLocalQueueObserver", args });
      return { status: "released" };
    },
    writeStateImpl: (_stateFile, payload) => {
      written = payload;
    },
    now: () => "2026-07-30T05:03:00.000Z",
  });

  assert.equal(revived.revived, true);
  assert.equal(revived.leaseId, "NPEL-QUEUED-REVIVE");
  assert.deepEqual(calls, [{
    tool: "releaseLocalQueueObserver",
    args: {
      path: "/tmp/dpf-local-ci-observer.json",
      token: "observer-token",
    },
  }]);
  assert.equal(written.status, "queued");
  assert.equal(written.gatePassed, false);
  assert.equal(written.leaseId, "NPEL-QUEUED-REVIVE");
  assert.equal(written.leaseEvents.at(-1).type, "pregate_interrupted_queue_revival");
  assert.equal(written.recovery.reason, "queued-gate-wrapper-exited-resuming");
  assert.equal(written.recovery.leasePreserved, true);
});

test("pregate revival refuses non-queued interrupted states", async () => {
  let wrote = false;
  const revived = await reviveInterruptedQueuedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-running-recovery",
      sha: "f".repeat(40),
      leaseId: "NPEL-RUNNING",
      status: "running",
      evidencePending: false,
    },
    branch: "fix/local-ci-running-recovery",
    sha: "f".repeat(40),
    childStatus: WINDOWS_WRAPPER_TERMINATED_STATUS,
    writeStateImpl: () => {
      wrote = true;
    },
  });

  assert.equal(revived.revived, false);
  assert.equal(wrote, false);
});

test("pregate recovery ignores terminal gate states", async () => {
  let releaseCalled = false;
  const recovered = await recoverInterruptedGateState({
    stateFile: "/tmp/dpf-local-ci-gate.json",
    state: {
      branch: "fix/local-ci-descendant-fence",
      sha: "b".repeat(40),
      leaseId: "NPEL-TERMINAL",
      status: "failed",
      evidencePending: false,
    },
    branch: "fix/local-ci-descendant-fence",
    sha: "b".repeat(40),
    bearerToken: "test-token",
    mcpCallImpl: async () => {
      releaseCalled = true;
      return { success: true };
    },
    writeStateImpl: () => {
      throw new Error("terminal states must not be rewritten");
    },
  });

  assert.equal(recovered.recovered, false);
  assert.equal(releaseCalled, false);
});

// BI-465B3D60. gate-worktree.mjs exits 75 after printing
// {status:"queued", code:"local_ci_durable_wait", resumeMode:"durable-task"} —
// the lease is a durable task that outlives this process. Recovery fired on any
// non-zero status, so it read that as an interrupted run, tried to release a
// lease it does not own, and stamped the state `failed`. `pregate:status` then
// reported "failed with NO recorded reason" for a queued, heartbeating lease.
test("a durable control-plane wait is not recovered as an interrupted gate", async () => {
  let contextResolved = false;
  const recovered = await recoverInterruptedGate({
    args: [],
    result: { status: EXIT_DURABLE_QUEUE_WAIT },
    spawnSyncImpl: () => {
      contextResolved = true;
      return { status: 0, stdout: "", stderr: "" };
    },
    stderr: { write: () => {} },
  });

  assert.deepEqual(recovered, { recovered: false, reason: "durable-control-plane-wait" });
  // It must bail before touching git or the lease at all — releasing a lease this
  // process does not own is what produced the misleading verdict.
  assert.equal(contextResolved, false);
});

test("a genuinely non-zero, non-queue exit still reaches recovery", async () => {
  // The guard must be exit-75-specific. Widening it would re-hide the real
  // interruptions this recovery exists to clean up.
  const recovered = await recoverInterruptedGate({
    args: [],
    result: { status: 1 },
    cwd: resolve(".pregate-does-not-exist"),
    spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "not a git worktree" }),
    stderr: { write: () => {} },
  });

  assert.notEqual(recovered.reason, "durable-control-plane-wait");
});

test("a clean exit is still not a recovery", async () => {
  const recovered = await recoverInterruptedGate({
    args: [],
    result: { status: 0 },
    stderr: { write: () => {} },
  });

  assert.equal(recovered.reason, "not-a-recoverable-invocation");
});

// BI-1669E08A. A claim for a HEAD that already carries a passing, non-stale gate
// record must report that pass and stop. Re-running can only lose information:
// the tree is identical, so a second verdict is either the same or wrong — and
// the second run takes the record with it the moment it starts.
//
// Reproduced twice on this install. 2026-09-10 on chore/retired-substrate-sweep:
// a waiting loop re-invoked pregate and a 0xC0000142 launch failure erased the
// PASS. 2026-09-12 on fix/local-ci-runner-tests-run-on-windows: NOTHING
// re-invoked pregate — the durable-wait detached resumer ran the gate to a PASS
// and the original queued claim was then also admitted, wrote `running` over the
// record, and died on blocked_control_plane_starvation. A two-step erasure.
test("a PASS at HEAD is reused instead of starting a second run", () => {
  assert.deepEqual(
    shouldReuseExistingPass({ args: [], verdictAtHead: "PASS" }),
    { reuse: true, reason: "a passing local-CI gate record already covers this HEAD" },
  );
});

test("every non-PASS verdict still runs the gate, and names what it saw", () => {
  for (const verdict of ["NO-RECORD", "STALE", "FAIL", "PENDING", "INCONCLUSIVE"]) {
    const decision = shouldReuseExistingPass({ args: [], verdictAtHead: verdict });
    assert.equal(decision.reuse, false, verdict);
    assert.match(decision.reason, new RegExp(verdict));
  }
  // An unreadable record must fail OPEN into running the gate, never into reuse:
  // corroboration that cannot be read is not corroboration (BI-A9CF0D69).
  const unreadable = shouldReuseExistingPass({ args: [], verdictAtHead: "" });
  assert.equal(unreadable.reuse, false);
  assert.match(unreadable.reason, /unreadable/);
});

test("--force-rerun re-gates a passing HEAD, and record-exempt invocations never reuse", () => {
  const forced = shouldReuseExistingPass({ args: ["--force-rerun"], verdictAtHead: "PASS" });
  assert.equal(forced.reuse, false);
  assert.match(forced.reason, /--force-rerun/);

  // --finalize-evidence exists precisely to act on an existing record; short-
  // circuiting it would make the reuse path eat its own recovery tool.
  for (const exempt of ["--dry-run", "--finalize-evidence", "--help", "-h"]) {
    const decision = shouldReuseExistingPass({ args: [exempt], verdictAtHead: "PASS" });
    assert.equal(decision.reuse, false, exempt);
    assert.match(decision.reason, /record-exempt/);
  }
});

test("the force flag is consumed by the wrapper and never forwarded to the gate", () => {
  // gate-worktree.mjs dies on an unknown option, so forwarding it would turn a
  // deliberate re-gate into a crash.
  assert.deepEqual(
    stripForceRerunFlag(["--branch", "fix/x", "--force-rerun", "--no-push"]),
    ["--branch", "fix/x", "--no-push"],
  );
  assert.deepEqual(stripForceRerunFlag([]), []);
  assert.deepEqual(stripForceRerunFlag(["--no-push"]), ["--no-push"]);
});
