import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BoundedTextTail,
  classifyVitestAttempt,
  runVitestWithRecovery,
  shouldRetryVitestAttempt,
} from "./local-ci-vitest-supervisor.mjs";

describe("classifyVitestAttempt", () => {
  it("classifies the observed Windows -1 exit without a summary as runner termination", () => {
    assert.equal(classifyVitestAttempt({
      status: -1,
      signal: null,
      error: null,
      outputTail: "[quiescence] final expected test log",
    }), "runner-termination");
  });

  it("does not retry a real failed-test summary", () => {
    assert.equal(classifyVitestAttempt({
      status: 1,
      signal: null,
      error: null,
      outputTail: "Test Files  1 failed | 2342 passed\nTests  1 failed | 20260 passed",
    }), "test-failure");
  });

  it("classifies a terminal passing summary as passed", () => {
    assert.equal(classifyVitestAttempt({
      status: 0,
      signal: null,
      error: null,
      outputTail: "Test Files  2343 passed\nTests  20261 passed",
    }), "passed");
  });

  it("classifies signal, spawn error, null status, and summary-free nonzero exits as runner termination", () => {
    for (const attempt of [
      { status: null, signal: null, error: null, outputTail: "" },
      { status: 1, signal: "SIGABRT", error: null, outputTail: "" },
      { status: 1, signal: null, error: new Error("spawn ENOMEM"), outputTail: "" },
      { status: 1, signal: null, error: null, outputTail: "last console line only" },
    ]) {
      assert.equal(classifyVitestAttempt(attempt), "runner-termination");
    }
  });
});

describe("bounded recovery", () => {
  it("allows one differentiated retry only for the first runner termination", () => {
    assert.equal(shouldRetryVitestAttempt({ classification: "runner-termination", attempt: 1 }), true);
    assert.equal(shouldRetryVitestAttempt({ classification: "runner-termination", attempt: 2 }), false);
    assert.equal(shouldRetryVitestAttempt({ classification: "test-failure", attempt: 1 }), false);
  });

  it("retries once with two workers and preserves both attempt diagnostics", async () => {
    const workerCounts = [];
    const result = await runVitestWithRecovery({
      runAttempt: async ({ workers, attempt }) => {
        workerCounts.push(workers);
        if (attempt === 1) {
          return {
            status: -1,
            signal: null,
            error: null,
            outputTail: "last completed file: quiescence.test.ts",
            childPid: 101,
            hostSamples: [{ freeMemoryBytes: 20_000_000_000 }],
          };
        }
        return {
          status: 0,
          signal: null,
          error: null,
          outputTail: "Test Files  2343 passed\nTests  20261 passed",
          childPid: 202,
          hostSamples: [{ freeMemoryBytes: 19_000_000_000 }],
        };
      },
    });

    assert.deepEqual(workerCounts, [4, 2]);
    assert.equal(result.status, 0);
    assert.equal(result.classification, "passed");
    assert.equal(result.recovered, true);
    assert.equal(result.attempts.length, 2);
    assert.equal(result.attempts[0].classification, "runner-termination");
    assert.equal(result.attempts[1].classification, "passed");
  });

  it("stops after a failed assertion and never runs the recovery attempt", async () => {
    let calls = 0;
    const result = await runVitestWithRecovery({
      runAttempt: async () => {
        calls += 1;
        return {
          status: 1,
          signal: null,
          error: null,
          outputTail: "Test Files  1 failed | 100 passed\nTests  1 failed | 900 passed",
        };
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.status, 1);
    assert.equal(result.classification, "test-failure");
    assert.equal(result.recovered, false);
  });

  it("can run only the inherited differentiated attempt after a prior host loss", async () => {
    const workerCounts = [];
    const result = await runVitestWithRecovery({
      initialWorkers: 2,
      retryWorkers: 2,
      allowRetry: false,
      runAttempt: async ({ workers }) => {
        workerCounts.push(workers);
        return { status: 0, signal: null, error: null, outputTail: "Tests  21000 passed" };
      },
    });

    assert.deepEqual(workerCounts, [2]);
    assert.equal(result.status, 0);
  });
});

describe("BoundedTextTail", () => {
  it("retains only the latest complete diagnostic window", () => {
    const tail = new BoundedTextTail(12);
    tail.append("12345678");
    tail.append("90abcdef");
    assert.equal(tail.toString(), "567890abcdef");
  });
});
