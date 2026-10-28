import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildGuardResult, buildRunRecord, spoolRecord } from "./guard-outcome-record.mjs";
import { submitSpool } from "./guard-outcome-submit.mjs";

function spoolOne(directory) {
  const record = buildRunRecord({
    runner: "pregate",
    runId: "00000000-0000-4000-8000-0000000000aa",
    startedAt: Date.parse("2026-10-14T00:00:00Z"),
    durationMs: 1,
    diff: { cloneKey: "0".repeat(16), branch: "feat/x", baseSha: "a".repeat(40), headSha: "b".repeat(40), patchId: null, dirty: false },
    guards: [buildGuardResult({ guardId: "loop:check-no-x", guardDigest: "c".repeat(64), verdict: "passed", durationMs: 1 })],
  });
  spoolRecord(record, { directory });
  return record.runId;
}

describe("submitSpool", () => {
  it("does nothing in CI or when disabled, and keeps the spool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-submit-"));
    try {
      spoolOne(dir);
      assert.equal((await submitSpool({ directory: dir, env: { CI: "true" } })).error, "submit-disabled");
      assert.equal((await submitSpool({ directory: dir, env: { DPF_GUARD_OUTCOME_SUBMIT: "0" } })).error, "submit-disabled");
      assert.equal(readdirSync(dir).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flushes through the given transport and clears acknowledged runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guard-submit-"));
    try {
      const runId = spoolOne(dir);
      const summary = await submitSpool({ directory: dir, env: {}, call: async () => ({ acknowledged: [runId], refused: [] }) });
      assert.equal(summary.submitted, 1);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
