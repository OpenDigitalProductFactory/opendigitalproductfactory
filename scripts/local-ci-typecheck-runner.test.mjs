import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyTypecheckResult,
  isInconclusiveTypecheck,
  runTypecheckStage,
  TSC_TERMINATED_EXIT_CODE,
} from "./local-ci-typecheck-runner.mjs";

test("typecheck classification keeps compiler failures distinct from opaque termination", () => {
  assert.equal(classifyTypecheckResult({ status: 0 }), "passed");
  assert.equal(classifyTypecheckResult({ status: 2 }), "failed");
  assert.equal(classifyTypecheckResult({ status: 4294967295 }), "runner-termination");
  assert.equal(classifyTypecheckResult({ status: null, signal: null }), "runner-termination");
});

test("typecheck writes and then reuses an exact-tree passed receipt", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "dpf-typecheck-")), "receipt.json");
  let launches = 0;
  const options = {
    receiptPath,
    resolveGitImpl: () => "tree-123",
    runObservedProcess: async ({ command, args }) => {
      launches += 1;
      assert.equal(command, "pnpm");
      assert.deepEqual(args, ["--filter", "web", "typecheck:all"]);
      return {
        status: 0,
        signal: null,
        error: null,
        outputTail: "Types generated successfully",
        childPid: 1234,
        hostSamples: [],
      };
    },
  };

  const first = await runTypecheckStage(options);
  const second = await runTypecheckStage(options);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(launches, 1);
  assert.equal(receipt.stage, "web-typecheck");
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.reuseCount, 1);
});

test("typecheck records a real compiler error without retrying", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "dpf-typecheck-red-")), "receipt.json");
  let launches = 0;
  const result = await runTypecheckStage({
    receiptPath,
    resolveGitImpl: () => "tree-red",
    runObservedProcess: async () => {
      launches += 1;
      return {
        status: 2,
        signal: null,
        error: null,
        outputTail: "TS2322: Type mismatch",
        childPid: 4321,
        hostSamples: [],
      };
    },
  });

  assert.equal(result.status, 2);
  assert.equal(result.classification, "failed");
  assert.equal(launches, 1);
  assert.match(readFileSync(receiptPath, "utf8"), /TS2322/);
});

// ── BI-27D3DCCD: a stage that reached no verdict must not report one ──

test("a compiler killed by a signal is infrastructure, not a type error", () => {
  // run-tsc.mjs exits 86 when spawnSync reports the child was terminated. pnpm
  // propagates that, so this is exactly what the stage observes.
  assert.equal(
    classifyTypecheckResult({ status: TSC_TERMINATED_EXIT_CODE, outputTail: "Types generated successfully" }),
    "runner-termination",
  );
  assert.equal(isInconclusiveTypecheck("runner-termination"), true);
});

test("a non-zero exit with no diagnostic at all did not grade anything", () => {
  // The observed shape: both programs print success, the stage exits non-zero,
  // and not one `error TS####` appears anywhere in the output.
  assert.equal(
    classifyTypecheckResult({
      status: 1,
      outputTail: "Generating route types...\nTypes generated successfully\n",
    }),
    "failed-without-diagnostics",
  );
  assert.equal(isInconclusiveTypecheck("failed-without-diagnostics"), true);
});

test("a real type error is still a verdict, and is still reported as failed", () => {
  assert.equal(
    classifyTypecheckResult({
      status: 2,
      outputTail: "lib/x.ts(3,5): error TS2322: Type is not assignable.",
    }),
    "failed",
  );
  assert.equal(isInconclusiveTypecheck("failed"), false);
});

test("with no output captured, a failure stays a failure rather than being excused", () => {
  // Fail-closed: absence of evidence about the output is not evidence the stage
  // was killed. Excusing every unobserved failure would hide real breakage.
  assert.equal(classifyTypecheckResult({ status: 2, outputTail: "" }), "failed");
  assert.equal(classifyTypecheckResult({ status: 2 }), "failed");
});

test("an inconclusive stage exits 86 and says so in the log, not only in the receipt", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "dpf-typecheck-killed-")), "receipt.json");
  const written = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  let result;
  try {
    result = await runTypecheckStage({
      receiptPath,
      resolveGitImpl: () => "tree-killed",
      runObservedProcess: async () => ({
        status: TSC_TERMINATED_EXIT_CODE,
        signal: "SIGKILL",
        error: null,
        outputTail: "Types generated successfully",
        childPid: 4242,
        hostSamples: [],
      }),
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(result.classification, "runner-termination");
  assert.equal(result.status, TSC_TERMINATED_EXIT_CODE);
  const log = written.join("");
  assert.match(log, /reached NO verdict on your changes/);
  assert.match(log, /terminated by SIGKILL/);

  // AC-TC-04: the signal is in the artifact too, so the next occurrence is
  // diagnosable without reproducing it.
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.signal, "SIGKILL");
  assert.equal(receipt.status, "runner-termination");
});

test("an inconclusive stage is never reused as a pass on the next run", async () => {
  const receiptPath = join(mkdtempSync(join(tmpdir(), "dpf-typecheck-reuse-")), "receipt.json");
  let launches = 0;
  const options = {
    receiptPath,
    resolveGitImpl: () => "tree-same",
    runObservedProcess: async () => {
      launches += 1;
      return {
        status: TSC_TERMINATED_EXIT_CODE,
        signal: "SIGKILL",
        error: null,
        outputTail: "Types generated successfully",
        childPid: 1,
        hostSamples: [],
      };
    },
  };

  await runTypecheckStage(options);
  await runTypecheckStage(options);
  assert.equal(launches, 2, "a stage that concluded nothing must run again, not be reused");
});
