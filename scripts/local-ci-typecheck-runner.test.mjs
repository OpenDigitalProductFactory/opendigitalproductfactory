import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyTypecheckResult,
  runTypecheckStage,
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
      assert.deepEqual(args, ["--filter", "web", "typecheck"]);
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
