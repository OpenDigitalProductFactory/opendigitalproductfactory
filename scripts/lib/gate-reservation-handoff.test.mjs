import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resumeUntilAdmitted } from "../local-ci-durable-wait-resumer.mjs";
import { advanceGateReservationPin } from "./gate-reservation-handoff.mjs";
import { quiescenceWait } from "./gate-quiescence.mjs";
import { EXIT_RUNNER_PREREQUISITE_UNAVAILABLE, EXIT_SOURCE_DRIFT, EXIT_WAIT_CANCELLED } from "./sandbox-freshness.mjs";

const SHA = "a".repeat(40);
const OWNER = "session-1";
const A = "NPEL-AAAAAAAAAA", B = "NPEL-BBBBBBBBBB", C = "NPEL-CCCCCCCCCC";
const ARGV = ["/repo/scripts/gate-worktree.mjs", "--branch", "fix/resume", "--sha", SHA,
  "--worktree", "/repo", "--owner-provider", "codex", "--owner-session-id", OWNER, "--resume-lease-id", A];
const last = (args, flag) => args[args.lastIndexOf(flag) + 1];
const queued = (leaseId, patch = {}) => ({ status: "queued", code: "local_ci_durable_wait", leaseId,
  taskRunId: "TR-NONPROD-EXAMPLE", claimKey: `local-ci:${OWNER}:${SHA}`, resumeMode: "durable-task", ...patch });
const quiescing = () => quiescenceWait({ level: "draining", runId: "SUR-EXAMPLE", retryAfterSeconds: 30 });

async function exercise(packets, { argv = ARGV, exits, prefix = "" } = {}) {
  const seen = [], logs = [];
  const result = await resumeUntilAdmitted({ gateArgv: argv, intervalMs: 1, deadlineMs: 10000,
    now: () => 0, sleepFn: async () => {}, log: (event, detail) => logs.push({ event, ...detail }),
    spawnFn: (_exe, args) => {
      const index = seen.length;
      seen.push([...args]);
      const stdout = new EventEmitter();
      return { stdout, once(event, fn) {
        if (event === "exit") queueMicrotask(() => {
          if (index < packets.length) stdout.emit("data", Buffer.from(prefix + packets[index] + "\n"));
          fn(exits?.[index] ?? (index < packets.length ? 75 : 0));
        });
      } };
    },
  });
  return { ...result, seen, logs };
}

test("two integration changes carry forward the latest reservation, without changing source or owner", async () => {
  const original = [...ARGV];
  const r = await exercise([JSON.stringify(queued(B)), JSON.stringify(queued(C))]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.seen.map((args) => last(args, "--resume-lease-id")), [A, B, C]);
  for (const args of r.seen) {
    const restored = [...args]; restored[restored.lastIndexOf("--resume-lease-id") + 1] = A;
    assert.deepEqual(restored, original);
  }
  assert.deepEqual(ARGV, original, "caller argv is immutable");
});

test("quiescence preserves the original reservation before a genuine queued handoff", async () => {
  const original = [...ARGV];
  const r = await exercise([JSON.stringify(quiescing()), JSON.stringify(queued(B))]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.seen.map(args => last(args, "--resume-lease-id")), [A, A, B]);
  assert.deepEqual(r.seen[0], r.seen[1]);
  assert.deepEqual(ARGV, original);
  assert.equal(r.logs.filter(row => row.event === "queue-reservation-handoff").length, 1);
});

for (const patch of [
  { resumeMode: "durable-task" }, { status: "queued" }, { retryAfterSeconds: 0 },
  { retryAfterSeconds: "30" }, { runId: {} }, { level: "" }, { leaseId: B },
]) test(`malformed quiescence cannot waive a pinned handoff: ${JSON.stringify(patch)}`, async () => {
  const r = await exercise([JSON.stringify({ ...quiescing(), ...patch })]);
  assert.equal(r.code, EXIT_RUNNER_PREREQUISITE_UNAVAILABLE);
  assert.equal(r.outcome.reason, "queue-handoff-unverified");
  assert.equal(r.seen.length, 1);
});

test("mixed quiescence and queue handoff remains ambiguous", async () => {
  const r = await exercise([JSON.stringify(quiescing()) + "\n" + JSON.stringify(queued(B))]);
  assert.equal(r.code, EXIT_RUNNER_PREREQUISITE_UNAVAILABLE);
  assert.equal(r.seen.length, 1);
});

test("quiescence cannot hide a malformed queue packet", async () => {
  const r = await exercise([JSON.stringify(quiescing()) + "\n"
    + JSON.stringify(queued(B, { status: "waiting" }))]);
  assert.equal(r.code, EXIT_RUNNER_PREREQUISITE_UNAVAILABLE);
  assert.equal(r.seen.length, 1);
});

for (const [name, packet] of [
  ["missing", "not a handoff"], ["foreign owner", JSON.stringify(queued(B, { claimKey: `local-ci:someone-else:${SHA}` }))],
  ["foreign source", JSON.stringify(queued(B, { claimKey: `local-ci:${OWNER}:${"b".repeat(40)}` }))],
  ["wrong lane", JSON.stringify(queued(B, { code: "host_resource_durable_wait" }))],
  ["malformed lease", JSON.stringify(queued({ toString: "not a string" }))],
  ["ambiguous", JSON.stringify(queued(B)) + "\n" + JSON.stringify(queued(C))],
]) {
  test(`unverified ${name} handoff stops unrun instead of replaying an obsolete pin`, async () => {
    const r = await exercise([packet]);
    assert.equal(r.code, EXIT_RUNNER_PREREQUISITE_UNAVAILABLE);
    assert.equal(r.attempts, 1);
    assert.equal(r.outcome.evidence, "unrun");
    assert.equal(r.outcome.reason, "queue-handoff-unverified");
    assert.equal(r.seen.length, 1);
  });
}

test("the canonical handoff is retained after bounded noisy output", async () => {
  const r = await exercise([JSON.stringify(queued(B))], { prefix: "x".repeat(100000) + "\n" });
  assert.equal(last(r.seen[1], "--resume-lease-id"), B);
  assert.ok(r.logs.filter((row) => row.event === "gate-output").reduce((n, row) => n + row.text.length, 0) <= 65536);
});

for (const code of [EXIT_WAIT_CANCELLED, EXIT_SOURCE_DRIFT]) {
  test(`terminal ${code} never adopts or retries a printed queue claim`, async () => {
    const r = await exercise([JSON.stringify(queued(B))], { exits: [code] });
    assert.equal(r.code, code); assert.equal(r.seen.length, 1);
  });
  test(`terminal ${code} never retries a printed quiescence wait`, async () => {
    const r = await exercise([JSON.stringify(quiescing())], { exits: [code] });
    assert.equal(r.code, code); assert.equal(r.seen.length, 1);
  });
}

test("quiescence retries remain bounded by the original deadline", async () => {
  let elapsed = 0;
  const r = await resumeUntilAdmitted({ gateArgv: ARGV, intervalMs: 10, deadlineMs: 10,
    now: () => elapsed, sleepFn: async () => { elapsed += 10; },
    spawnFn: () => { const stderr = new EventEmitter(); return { stderr, once(event, fn) {
      if (event === "exit") queueMicrotask(() => {
        stderr.emit("data", Buffer.from(JSON.stringify(quiescing()) + "\n")); fn(75);
      });
    } }; },
  });
  assert.equal(r.code, 75); assert.equal(r.attempts, 1);
});

for (const stream of ["stdout", "stderr"]) test(`real ${stream} quiescence retains its pin before handoff`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "quiescence-handoff-"));
  const script = join(dir, "gate-worktree.mjs"), seenPath = join(dir, "seen.jsonl");
  try {
    writeFileSync(script, `import {existsSync,readFileSync,appendFileSync} from 'node:fs';
const file = ${JSON.stringify(seenPath)};
const prior = existsSync(file) ? readFileSync(file,'utf8').trim().split('\\n').length : 0;
const pin = process.argv[process.argv.lastIndexOf('--resume-lease-id')+1];
appendFileSync(file,JSON.stringify(pin)+'\\n');
const packet = prior === 0 ? ${JSON.stringify(quiescing())} : prior === 1 ? ${JSON.stringify(queued(B))} : null;
if (packet) { process.${stream}.write(JSON.stringify(packet)+'\\n'); process.exit(75); }
process.exit(0);`);
    const r = await resumeUntilAdmitted({ gateArgv: [script, ...ARGV.slice(1)],
      intervalMs: 1, deadlineMs: 10000 });
    assert.equal(r.code, 0);
    assert.deepEqual(readFileSync(seenPath, "utf8").trim().split("\n").map(JSON.parse), [A, A, B]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("host resource invocations retain their separate immutable pin contract", async () => {
  const argv = ["/repo/scripts/host-resource-runner.mjs", "--resume-pin", "resource-pin", "--", "node", "worker.mjs"];
  const r = await exercise([JSON.stringify(queued(B))], { argv });
  assert.equal(r.code, 0); assert.deepEqual(r.seen, [argv, argv]);
});

test("the final queued packet is drained after process exit before adopting its reservation", async () => {
  const seen = [];
  const r = await resumeUntilAdmitted({ gateArgv: ARGV, intervalMs: 1, deadlineMs: 10000,
    now: () => 0, sleepFn: async () => {},
    spawnFn: (_exe, args) => {
      const index = seen.length; seen.push([...args]);
      const child = new ChildProcess(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit("exit", index === 0 ? 75 : 0);
        queueMicrotask(() => {
          if (index === 0) child.stdout.emit("data", Buffer.from(JSON.stringify(queued(B)) + "\n"));
          child.emit("close", index === 0 ? 75 : 0);
        });
      });
      return child;
    },
  });
  assert.equal(r.code, 0); assert.equal(last(seen[1], "--resume-lease-id"), B);
});

for (const stream of ["stdout", "stderr"]) test(`real child processes progress through two reservation replacements on ${stream}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reservation-handoff-"));
  const script = join(dir, "gate-worktree.mjs");
  try {
    writeFileSync(script, `const lease = process.argv[process.argv.lastIndexOf("--resume-lease-id") + 1];
const next = lease === ${JSON.stringify(A)} ? ${JSON.stringify(B)} : lease === ${JSON.stringify(B)} ? ${JSON.stringify(C)} : null;
if (next) { process.${stream}.write(JSON.stringify({...${JSON.stringify(queued(B))}, leaseId: next}) + "\\n"); process.exit(75); }
process.exit(0);
`);
    const argv = [script, ...ARGV.slice(1)]; const handoffs = [];
    const result = await resumeUntilAdmitted({ gateArgv: argv, intervalMs: 1, deadlineMs: 10000,
      log: (event, detail) => { if (event === "queue-reservation-handoff") handoffs.push(detail); } });
    assert.equal(result.code, 0); assert.equal(result.attempts, 3);
    assert.deepEqual(handoffs.map((row) => [row.priorLeaseId, row.leaseId]), [[A, B], [B, C]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Windows paths and repeated options preserve the gate parser's last-value-wins pin", () => {
  const argv = ["C:\\repo\\scripts\\gate-worktree.mjs", "--sha", "b".repeat(40), ...ARGV.slice(1), `--resume-lease-id=${A}`];
  const result = advanceGateReservationPin(argv, JSON.stringify(queued(B)));
  assert.equal(result.valid, true);
  assert.equal(result.argv.at(-1), `--resume-lease-id=${B}`);
  assert.deepEqual(result.argv.slice(0, -1), argv.slice(0, -1));
});

test("a forwarded leading separator preserves the exact flag location", () => {
  const argv = [ARGV[0], "--", ...ARGV.slice(1)];
  const result = advanceGateReservationPin(argv, JSON.stringify(queued(B)));
  assert.equal(result.valid, true);
  assert.equal(last(result.argv, "--resume-lease-id"), B);
  assert.deepEqual(result.argv.slice(0, -1), argv.slice(0, -1));
});

test("a missing reservation argument stops unrun without parsing an invented pin", () => {
  const argv = ARGV.slice(0, -1);
  const result = advanceGateReservationPin(argv, JSON.stringify(queued(B)));
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid-source-pin");
});
