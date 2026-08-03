import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  createAttemptRunner,
  lastCompletedTestLine,
  selectVitestRecoveryPlan,
} from "./local-ci-vitest-runner.mjs";

test("lastCompletedTestLine returns the latest verbose Vitest test marker", () => {
  assert.equal(lastCompletedTestLine([
    "stdout before tests",
    " ✓ lib/first.test.ts > first",
    " ✓ lib/last.test.ts > last",
  ].join("\n")), "✓ lib/last.test.ts > last");
});

test("a prior externally terminated receipt resumes at the differentiated worker count", () => {
  assert.deepEqual(selectVitestRecoveryPlan({
    priorDisposition: "externally-terminated",
    initialWorkers: 4,
    retryWorkers: 2,
  }), {
    initialWorkers: 2,
    retryWorkers: 2,
    allowRetry: false,
    recoveringPriorTermination: true,
  });
  assert.equal(selectVitestRecoveryPlan({
    priorDisposition: "terminal-or-absent",
    initialWorkers: 4,
    retryWorkers: 2,
  }).initialWorkers, 4);
});

test("attempt runner streams output and retains progress plus host evidence on opaque exit", async () => {
  const child = new EventEmitter();
  child.pid = 4123;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const streamed = { stdout: "", stderr: "" };
  let invocation = null;
  const runAttempt = createAttemptRunner({
    spawnImpl(command, args) {
      invocation = { command, args };
      queueMicrotask(() => {
        child.stdout.write(" ✓ apps/web/last.test.ts > completes\n");
        child.stderr.write("worker closed without summary\n");
        child.emit("close", -1, null);
      });
      return child;
    },
    sampleHost: (pid) => ({ pid, freeMemoryBytes: 24_000_000_000 }),
    stdout: { write: (chunk) => { streamed.stdout += String(chunk); } },
    stderr: { write: (chunk) => { streamed.stderr += String(chunk); } },
    sampleIntervalMs: 60_000,
  });

  const result = await runAttempt({ workers: 4, attempt: 1 });

  assert.equal(invocation.command, "pnpm");
  assert.ok(invocation.args.includes("--maxWorkers=4"));
  assert.ok(invocation.args.includes("--reporter=verbose"));
  assert.match(streamed.stdout, /last\.test\.ts/);
  assert.match(streamed.stderr, /without summary/);
  assert.equal(result.status, -1);
  assert.equal(result.lastCompletedTest, "✓ apps/web/last.test.ts > completes");
  assert.ok(result.hostSamples.length >= 2);
  assert.equal(result.hostSamples[0].pid, 4123);
});
