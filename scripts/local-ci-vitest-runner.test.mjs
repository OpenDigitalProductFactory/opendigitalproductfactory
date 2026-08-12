import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  createAttemptRunner,
  lastCompletedTestLine,
  recoveryReceiptForIdentity,
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
    priorExecutionProfile: { mode: "initial", workers: 4 },
    initialWorkers: 4,
    retryWorkers: 2,
  }), {
    initialWorkers: 2,
    retryWorkers: 2,
    allowRetry: false,
    recoveringPriorTermination: true,
    exhausted: false,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  });
  assert.equal(selectVitestRecoveryPlan({
    priorDisposition: "terminal-or-absent",
    initialWorkers: 4,
    retryWorkers: 2,
  }).initialWorkers, 4);
});

test("a vanished differentiated receipt exhausts recovery before another child starts", () => {
  assert.deepEqual(selectVitestRecoveryPlan({
    priorDisposition: "externally-terminated",
    priorExecutionProfile: { mode: "differentiated-recovery", workers: 2 },
    initialWorkers: 4,
    retryWorkers: 2,
  }), {
    initialWorkers: 2,
    retryWorkers: 2,
    allowRetry: false,
    recoveringPriorTermination: true,
    exhausted: true,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  });
  assert.equal(selectVitestRecoveryPlan({
    priorDisposition: "retry-exhausted",
    priorExecutionProfile: { mode: "differentiated-recovery", workers: 2 },
    initialWorkers: 4,
    retryWorkers: 2,
  }).exhausted, true);
});

test("a changed integration identity starts a fresh recovery budget", () => {
  const receipt = {
    stage: "exhaustive-vitest",
    status: "running",
    identity: { integrationTreeSha: "old-tree", command: "vitest" },
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
  };

  assert.equal(recoveryReceiptForIdentity({
    receipt,
    identity: { integrationTreeSha: "new-tree", command: "vitest" },
  }), null);
  assert.equal(recoveryReceiptForIdentity({
    receipt,
    identity: receipt.identity,
  }), receipt);
});

test("the executable runner refuses a persisted exhausted profile before spawn", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-vitest-exhausted-"));
  const metadataPath = join(temp, "metadata.json");
  const diagnosticsPath = `${metadataPath}.vitest.json`;
  const integrationTreeSha = execFileSync(
    "git",
    ["rev-parse", "HEAD^{tree}"],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
  writeFileSync(diagnosticsPath, `${JSON.stringify({
    schemaVersion: 1,
    stage: "exhaustive-vitest",
    identity: {
      integrationTreeSha,
      command: "pnpm --filter web exec vitest run --maxWorkers=4 --reporter=verbose",
    },
    status: "runner-termination",
    retryExhausted: true,
    executionProfile: { mode: "differentiated-recovery", workers: 2 },
    hostPid: 999_999,
    lastHeartbeatAt: "2026-08-08T00:00:00.000Z",
    observations: [],
  })}\n`);

  try {
    const result = spawnSync(process.execPath, [
      "scripts/local-ci-vitest-runner.mjs",
      "--initial-workers", "4",
      "--retry-workers", "2",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DPF_LOCAL_CI_METADATA_FILE: metadataPath },
    });
    assert.equal(result.status, 86, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /without another child/);
    assert.equal(JSON.parse(readFileSync(diagnosticsPath, "utf8")).retryExhausted, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
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
