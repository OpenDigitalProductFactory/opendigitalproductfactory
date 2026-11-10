import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main, parseHookArgs } from "./record-guard-outcome.mjs";

describe("record-guard-outcome CLI", () => {
  it("parses a hook verdict and refuses unknown runners or verdicts", () => {
    assert.deepEqual(parseHookArgs(["--runner", "pre-push-gate", "--verdict", "refused", "--duration-ms", "120"])?.verdict, "refused");
    assert.equal(parseHookArgs(["--runner", "ci", "--verdict", "refused"]), null);
    assert.equal(parseHookArgs(["--runner", "pre-push-gate", "--verdict", "maybe"]), null);
  });

  it("records one hook-kind result for the pre-push gate", async () => {
    let recorded;
    const result = await main(["--runner", "pre-push-gate", "--verdict", "passed", "--duration-ms", "50"], {
      record: async (input) => { recorded = input; },
      now: () => 1_000_000,
    });
    assert.deepEqual(result, { recorded: true });
    assert.equal(recorded.runner, "pre-push-gate");
    assert.equal(recorded.guards.length, 1);
    assert.deepEqual(
      { guardId: recorded.guards[0].guardId, kind: recorded.guards[0].kind, verdict: recorded.guards[0].verdict },
      { guardId: "hook:pre-push-gate", kind: "hook", verdict: "passed" },
    );
    assert.match(recorded.guards[0].guardDigest, /^[0-9a-f]{64}$/);
    assert.equal(recorded.startedAt, 1_000_000 - 50);
  });

  it("bad usage records nothing", async () => {
    let called = false;
    const result = await main(["--runner", "nope"], { record: async () => { called = true; } });
    assert.deepEqual(result, { recorded: false, reason: "usage" });
    assert.equal(called, false);
  });
});
