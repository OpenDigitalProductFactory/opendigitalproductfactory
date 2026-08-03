import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicWriteJson,
  canonicalStageReceiptStatus,
  classifyPriorStage,
  createStageReceiptWriter,
  markStageReceiptReused,
  readStageReceipt,
  reusablePassedStage,
} from "./local-ci-stage-receipt.mjs";

const identity = {
  candidateSha: "candidate-a",
  integrationTreeSha: "tree-a",
  command: "pnpm --filter web exec vitest run --maxWorkers=4",
};

test("retries a transient Windows rename lock without losing the receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-stage-receipt-lock-"));
  const path = join(directory, "receipt.json");
  let attempts = 0;

  atomicWriteJson(path, { status: "running" }, {
    renameImpl(source, destination) {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("transient Windows receipt lock");
        error.code = "EPERM";
        throw error;
      }
      renameSync(source, destination);
    },
    sleepImpl() {},
  });

  assert.equal(attempts, 3);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { status: "running" });
});

test("writes running heartbeats and a terminal stage receipt atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-stage-receipt-"));
  const path = join(directory, "receipt.json");
  const times = [
    new Date("2026-08-01T18:00:00.000Z"),
    new Date("2026-08-01T18:00:05.000Z"),
    new Date("2026-08-01T18:00:10.000Z"),
  ];
  const writer = createStageReceiptWriter({
    path,
    stage: "production-build",
    identity,
    hostPid: 42,
    now: () => times.shift(),
  });

  writer.start({ childPid: 84 });
  writer.heartbeat({ freeMemoryBytes: 1024 });
  writer.complete("passed", { exitCode: 0 });

  const persisted = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(persisted.status, "passed");
  assert.equal(persisted.hostPid, 42);
  assert.equal(persisted.childPid, 84);
  assert.equal(persisted.observations.length, 1);
  assert.equal(persisted.completedAt, "2026-08-01T18:00:10.000Z");
  assert.deepEqual(readStageReceipt(path), persisted);
});

test("reuses only an exact-identity passed receipt", () => {
  const receipt = {
    schemaVersion: 1,
    stage: "exhaustive-vitest",
    identity,
    status: "passed",
  };
  assert.equal(reusablePassedStage({ receipt, stage: "exhaustive-vitest", identity }), true);
  assert.equal(reusablePassedStage({
    receipt,
    stage: "exhaustive-vitest",
    identity: { ...identity, integrationTreeSha: "tree-b" },
  }), false);
  assert.equal(reusablePassedStage({ receipt, stage: "production-build", identity }), false);
});

test("identity comparison is canonical across object key order", () => {
  const receipt = {
    schemaVersion: 1,
    stage: "exhaustive-vitest",
    identity: {
      command: identity.command,
      integrationTreeSha: identity.integrationTreeSha,
      candidateSha: identity.candidateSha,
    },
    status: "passed",
  };
  assert.equal(reusablePassedStage({ receipt, stage: "exhaustive-vitest", identity }), true);
});

test("normalizes a healthy build result to the canonical passed receipt status", () => {
  assert.equal(canonicalStageReceiptStatus("healthy"), "passed");
  assert.equal(canonicalStageReceiptStatus("failed"), "failed");
});

test("marks reuse atomically without weakening a passed receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "dpf-stage-reuse-"));
  const path = join(directory, "receipt.json");
  const receipt = {
    schemaVersion: 1,
    stage: "exhaustive-vitest",
    identity,
    status: "passed",
  };
  const reused = markStageReceiptReused({
    path,
    receipt,
    now: () => new Date("2026-08-01T19:00:00.000Z"),
  });
  assert.equal(reused.status, "passed");
  assert.equal(reused.reused, true);
  assert.equal(reused.reuseCount, 1);
  assert.equal(reused.lastReusedAt, "2026-08-01T19:00:00.000Z");
  assert.deepEqual(readStageReceipt(path), reused);
  assert.throws(
    () => markStageReceiptReused({ path, receipt: { ...receipt, status: "running" } }),
    /only a passed stage receipt/,
  );
});

test("classifies a running receipt whose host disappeared as externally terminated", () => {
  const receipt = { status: "running", hostPid: 42 };
  assert.equal(classifyPriorStage({ receipt, isProcessAlive: () => false }), "externally-terminated");
  assert.equal(classifyPriorStage({ receipt, isProcessAlive: () => true }), "still-running");
  assert.equal(classifyPriorStage({ receipt: { status: "passed" } }), "terminal-or-absent");
});
