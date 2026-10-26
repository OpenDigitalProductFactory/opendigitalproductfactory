// scripts/gate-wait.test.mjs — BI-22E11EA2
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { classifyGateExit, GATE_EXIT } from "./lib/gate-exit-classification.mjs";
import { EXIT_CANDIDATE_MERGE_CONFLICT, EXIT_SOURCE_DRIFT, EXIT_WAIT_CANCELLED } from "./lib/sandbox-freshness.mjs";
import { delayForAttempt, parseGateStatus, pregateSpawnOptions, runPregate, waitForGate } from "./gate-wait.mjs";

const noSleep = async () => {};

test("infrastructure exits are inconclusive, not a verdict about the diff", () => {
  for (const code of [GATE_EXIT.DURABLE_WAIT, GATE_EXIT.CONTROL_PLANE_STARVATION, GATE_EXIT.CHILD_SIGNAL_DEATH, GATE_EXIT.ABANDONED_OR_UNRECORDED]) {
    const v = classifyGateExit({ code });
    assert.equal(v.retry, true, `exit ${code} must retry`);
    assert.equal(v.verdict, "none", `exit ${code} must not carry a verdict`);
  }
});

test("exit 1 carrying lease-lost text is infrastructure, not a failing diff", () => {
  const v = classifyGateExit({ code: 1, output: "gate-worktree: local-CI lease authority lost while waiting for the host process fence" });
  assert.equal(v.kind, "lease-lost");
  assert.equal(v.retry, true);
  assert.equal(v.verdict, "none");
});

test("a plain exit 1 is a real failure and stops immediately", () => {
  const v = classifyGateExit({ code: 1, output: "FAIL lib/foo.test.ts" });
  assert.equal(v.verdict, "fail");
  assert.equal(v.retry, false);
});

// BI-2FFDBE62: spawnSync("pnpm") on Windows returns status null. That is a
// process that never started, not a verdict about the diff.
for (const exitCode of [0, 23]) {
  test(`Windows pregate launcher executes the installed pnpm entrypoint and preserves exit ${exitCode}`, t => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "dpf gate wait & literal-")));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const script = join(root, "node_modules", "pnpm", "bin", "pnpm.cjs");
    mkdirSync(dirname(script), { recursive: true });
    writeFileSync(join(root, "pnpm.cmd"), "@echo off\r\nexit /b 99\r\n");
    writeFileSync(script, `console.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), capture: process.env.DPF_PREGATE_ALLOW_CAPTURE, literal: process.env.DPF_TEST_LITERAL })); process.exit(${exitCode});\n`);
    const literal = "%PATH% !NAME! a&b|c<>d^e";
    const spec = pregateSpawnOptions({ platform: "win32", env: { Path: root, DPF_TEST_LITERAL: literal }, cwd: root });
    let result;
    const launch = runPregate({ platform: "win32", env: spec.options.env, cwd: root,
      spawnSyncImpl: (command, args, options) => (result = spawnSync(command, args, { ...options, stdio: "pipe", encoding: "utf8", timeout: 5000 })) });
    assert.equal(launch.code, exitCode, launch.launchError);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, exitCode, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { argv: ["run", "pregate"], cwd: root, capture: "1", literal });
    assert.equal(spec.options.shell, false);
    assert.equal(spec.options.stdio, "inherit");
  });
}

test("POSIX pregate keeps direct pnpm invocation and allows captured pregate", () => {
  const posix = pregateSpawnOptions({ platform: "linux", env: { PATH: "x" }, cwd: "/repo" });
  assert.equal(posix.command, "pnpm");
  assert.deepEqual(posix.args, ["run", "pregate"]);
  assert.equal(posix.options.cwd, "/repo");
  assert.equal(posix.options.shell, false);
  assert.equal(posix.options.env.DPF_PREGATE_ALLOW_CAPTURE, "1");
  assert.equal(posix.options.env.PATH, "x");
});
for (const layout of ["missing", "unsupported"]) {
  test(`Windows ${layout} pnpm is an actionable unrun gate without a spawn or retry`, async t => {
    const root = mkdtempSync(join(tmpdir(), "dpf gate resolution-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    if (layout === "unsupported") writeFileSync(join(root, "pnpm.cmd"), "@echo off\r\n");
    let attempts = 0, spawns = 0;
    const events = [];
    const result = await waitForGate({
      readStatus: async () => ({ verdict: "NO-RECORD" }), sleep: noSleep,
      runGate: () => {
        attempts++;
        return runPregate({ platform: "win32", env: { Path: root }, cwd: root,
          spawnSyncImpl: () => { spawns++; throw new Error("unexpected spawn"); } });
      },
      log: event => events.push(event),
    });
    assert.equal(attempts, 1);
    assert.equal(spawns, 0);
    assert.equal(result.outcome, "inconclusive");
    assert.equal(result.exitCode, GATE_EXIT.ABANDONED_OR_UNRECORDED);
    assert.equal(result.verdict.kind, "spawn-failed");
    assert.equal(result.verdict.verdict, "none");
    assert.match(result.verdict.summary, layout === "missing" ? /Cannot resolve pnpm on PATH/ : /JavaScript entrypoint/);
    assert.equal(events[0].summary, result.verdict.summary);
  });
}

test("reported and thrown launch errors retain diagnostics and cannot become a pass", () => {
  for (const spawnSyncImpl of [
    () => ({ status: 0, error: new Error("spawn failed: EACCES") }),
    () => { throw new Error("spawn failed: EACCES"); },
  ]) {
    const result = runPregate({ platform: "linux", env: {}, spawnSyncImpl });
    assert.equal(result.code, null);
    assert.equal(result.launchError, "spawn failed: EACCES");
    assert.equal(classifyGateExit(result).verdict, "none");
  }
});
test("a null exit means pregate did not start and is not a diff failure", () => {
  for (const code of [null, undefined]) {
    const v = classifyGateExit({ code });
    assert.equal(v.kind, "spawn-failed", `code ${code}`);
    assert.equal(v.retry, false);
    assert.equal(v.verdict, "none");
    assert.doesNotMatch(v.summary, /gate failed/);
  }
});

// BI-4BCD269B: a wrapped pregate stops before it occupies the pool. The code
// must not fall through to a product FAIL.
test("exit 11 is a wrapped invocation, not a product failure", () => {
  assert.equal(GATE_EXIT.WRAPPED_INVOCATION, 11);
  const v = classifyGateExit({ code: 11 });
  assert.equal(v.kind, "wrapped");
  assert.equal(v.retry, false);
  assert.equal(v.verdict, "none");
});

// BI-FCC1DCB2: a candidate that conflicts with origin/main fails the same way on
// every retry. It is the author's to fix, so it stops and names the merge.
test("a merge conflict with the base is a failing verdict that does not retry", () => {
  assert.equal(GATE_EXIT.MERGE_CONFLICT_WITH_BASE, EXIT_CANDIDATE_MERGE_CONFLICT);
  const v = classifyGateExit({ code: EXIT_CANDIDATE_MERGE_CONFLICT });
  assert.equal(v.kind, "merge-conflict-with-base");
  assert.equal(v.retry, false);
  assert.equal(v.verdict, "fail");
  assert.match(v.next, /merge origin\/main into your branch and resolve/);
});

test("sandbox drift does not spin — retrying cannot converge a sandbox", () => {
  const v = classifyGateExit({ code: GATE_EXIT.SANDBOX_DRIFT });
  assert.equal(v.retry, false);
  assert.equal(v.verdict, "none");
  assert.match(v.next, /converge the sandbox/);
});

test("evidence-pending is a PASS that needs finalizing, not a failure", () => {
  const v = classifyGateExit({ code: GATE_EXIT.EVIDENCE_PENDING });
  assert.equal(v.verdict, "pass");
  assert.equal(v.retry, false);
  assert.match(v.next, /--finalize-evidence/);
});

const noStatus = async () => ({ verdict: "NO-RECORD" });

test("a PASS already recorded for this HEAD is never re-gated (BI-1669E08A)", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: "PASS" }),
    runGate: async () => { gateCalls++; return { code: 0 }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(gateCalls, 0, "re-invoking the gate would start a run whose verdict supersedes the pass");
});

test("a FAIL recorded for this HEAD is reported without re-running the gate", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: "FAIL" }),
    runGate: async () => { gateCalls++; return { code: 0 }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
  assert.equal(gateCalls, 0);
});

test("after a queue it WATCHES the status instead of re-claiming the gate", async () => {
  // The runbook: on exit 75 the claim goes to a detached resumer and the caller
  // must stop polling the gate. Re-invoking would start a second run of the
  // same tree.
  let gateCalls = 0;
  const statuses = ["NO-RECORD", "NO-RECORD", "NO-RECORD", "PASS"];
  let i = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: statuses[Math.min(i++, statuses.length - 1)] }),
    runGate: async () => { gateCalls++; return { code: GATE_EXIT.DURABLE_WAIT }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(gateCalls, 1, "the gate is claimed once; the resumer is then watched, not raced");
});

test("a durable queue is observed beyond the old watch window without another claim", async () => {
  let gateCalls = 0, clock = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => { gateCalls++; return { code: GATE_EXIT.DURABLE_WAIT }; },
    sleep: async ms => { clock += ms; }, now: () => clock,
    deadlineMinutes: 5, firstDelaySeconds: 1, maxDelaySeconds: 1,
  });
  assert.equal(result.outcome, "deadline");
  assert.equal(gateCalls, 1);
});

test("an existing admitted claim with stale metadata is watched rather than re-claimed", async () => {
  let calls = 0, reads = 0;
  const result = await waitForGate({
    readStatus: async () => ++reads > 12 ? { verdict: "PASS" }
      : { verdict: "STALE", gateStatus: "admitted", headSha: "head", boundSha: "head" },
    runGate: async () => { calls++; return { code: GATE_EXIT.DURABLE_WAIT }; }, sleep: noSleep,
  });
  assert.equal(result.outcome, "passed");
  assert.equal(calls, 0);
});

for (const gateStatus of ["cancelled", "expired", "abandoned"]) {
  test(`a terminal ${gateStatus} claim stops without re-claiming`, async () => {
    let calls = 0;
    const result = await waitForGate({
      readStatus: async () => ({ verdict: "INCONCLUSIVE", gateStatus, headSha: "head", boundSha: "head" }),
      runGate: async () => { calls++; return { code: 0 }; }, sleep: noSleep,
    });
    assert.equal(result.exitCode, GATE_EXIT.ABANDONED_OR_UNRECORDED);
    assert.equal(result.outcome, "inconclusive");
    assert.equal(calls, 0);
  });
}

test("surfaces a genuine failure on the first attempt without burning the queue", async () => {
  let calls = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => { calls++; return { code: 1 }; },
    sleep: noSleep,
  });
  assert.equal(calls, 1);
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
});

test("a deadline with no verdict exits 7 — never 0, never 1", async () => {
  let clock = 0;
  const result = await waitForGate({
    readStatus: noStatus,
    runGate: async () => ({ code: GATE_EXIT.DURABLE_WAIT }),
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    deadlineMinutes: 1,
  });
  assert.equal(result.outcome, "deadline");
  assert.equal(result.exitCode, GATE_EXIT.ABANDONED_OR_UNRECORDED);
  assert.notEqual(result.exitCode, 0, "a run that never gated must not read as a pass");
  assert.notEqual(result.exitCode, 1, "a run that never gated must not read as a failing diff");
});

test("an unreadable status is treated as no verdict, never as a pass", async () => {
  let gateCalls = 0;
  const result = await waitForGate({
    readStatus: async () => null,
    runGate: async () => { gateCalls++; return { code: 1 }; },
    sleep: noSleep,
  });
  assert.equal(gateCalls, 0);
  assert.equal(result.outcome, "inconclusive");
});

test("backoff ramps and then holds", () => {
  assert.equal(delayForAttempt(1), 20);
  assert.equal(delayForAttempt(3), 40);
  assert.equal(delayForAttempt(99), 60);
});

// BI-D35B85BF: a cancelled wait and a moved source are final, unrun, never retried.
test("a cancelled wait and a drifted resume are final and never retried", () => {
  assert.equal(GATE_EXIT.WAIT_CANCELLED, EXIT_WAIT_CANCELLED);
  assert.equal(GATE_EXIT.SOURCE_DRIFT, EXIT_SOURCE_DRIFT);
  for (const code of [EXIT_WAIT_CANCELLED, EXIT_SOURCE_DRIFT]) {
    const result = classifyGateExit({ code });
    assert.equal(result.retry, false);
    assert.equal(result.verdict, "none");
  }
});

test("exit 1 whose record says INCONCLUSIVE stops without retrying infrastructure", async () => {
  // Observed 2026-10-06: pregate exited 1, the record it wrote was
  // INCONCLUSIVE (blocked_wrapper_exited — "not a product verdict"), and
  // gate:wait reported "gate failed". pregate runs with inherited stdio, so the
  // exit-1 text discriminator never sees output; the record is the verdict.
  let gateCalls = 0;
  const statuses = ["NO-RECORD", "INCONCLUSIVE", "PASS"];
  let i = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: statuses[Math.min(i++, statuses.length - 1)] }),
    runGate: async () => { gateCalls++; return { code: 1 }; },
    sleep: noSleep,
  });
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.exitCode, GATE_EXIT.ABANDONED_OR_UNRECORDED);
  assert.equal(gateCalls, 1);
  assert.equal(result.attempts[0].kind, "infrastructure");
});

test("exit 1 whose record says FAIL is still a failure", async () => {
  const statuses = ["NO-RECORD", "FAIL"];
  let i = 0;
  const result = await waitForGate({
    readStatus: async () => ({ verdict: statuses[Math.min(i++, statuses.length - 1)] }),
    runGate: async () => ({ code: 1 }),
    sleep: noSleep,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 1);
});

// BI-277ECBDB: a dead slot substrate is final until the container runs. Retrying
// re-probes, fails the same way, and only burns the host.
test("an unavailable slot substrate is a non-verdict that is never retried", () => {
  const v = classifyGateExit({ code: GATE_EXIT.SLOT_SUBSTRATE_UNAVAILABLE });
  assert.equal(v.kind, "substrate-unavailable");
  assert.equal(v.verdict, "none");
  assert.equal(v.retry, false);
  assert.match(v.summary, /^BLOCKED — slot substrate unavailable/);
  assert.match(v.next, /pregate:status/);
});

test("reads the complete multiline status JSON and refuses malformed or unknown verdicts", () => {
  const report = { verdict: "INCONCLUSIVE", gateStatus: "cancelled", headSha: "head", boundSha: "head" };
  assert.deepEqual(parseGateStatus(JSON.stringify(report, null, 2)), report);
  assert.equal(parseGateStatus("{"), null);
  assert.equal(parseGateStatus('{"verdict":"invented-pass"}'), null);
});

test("pending evidence is not a reason to rerun the gate", async () => {
  let calls = 0;
  const result = await waitForGate({ readStatus: async () => ({ verdict: "PENDING" }),
    runGate: async () => { calls++; return { code: 0 }; }, sleep: noSleep });
  assert.equal(calls, 0);
  assert.equal(result.outcome, "inconclusive");
});
