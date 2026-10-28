import { describe, expect, it } from "vitest";

import { handleGuardOutcomesPayload, hasGuardOutcomesPayload } from "./guard-outcome-intake";
import type { GuardOutcomeWriteDb } from "./record-guard-outcomes";

const RUN_ID = "00000000-0000-4000-8000-0000000000f1";

function run() {
  return {
    schema: "guard-outcome-run.v1",
    runId: RUN_ID,
    runner: "pre-push-gate",
    startedAt: "2026-10-27T00:00:00.000Z",
    durationMs: 5,
    diff: { cloneKey: "0".repeat(16), branch: "feat/x", baseSha: "a".repeat(40), headSha: "b".repeat(40), patchId: null, dirty: false },
    override: null,
    declarationsDigest: null,
    guards: [{ guardId: "hook:pre-push-gate", kind: "hook", guardDigest: "c".repeat(64), baselineDigest: null, verdict: "passed", durationMs: 5 }],
  };
}

function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db: GuardOutcomeWriteDb = {
    externalEvidenceRecord: {
      async create({ data }) {
        rows.push(data as unknown as Record<string, unknown>);
        return { id: String(data.id) };
      },
      async findUnique() {
        return null;
      },
    },
  };
  return { db, rows };
}

describe("guard outcomes on the external development evidence lane", () => {
  it("detects the payload only when present", () => {
    expect(hasGuardOutcomesPayload({ provider: "claude" })).toBe(false);
    expect(hasGuardOutcomesPayload({ guardOutcomes: { records: [] } })).toBe(true);
  });

  it("records runs with the producer taken from the MCP caller, not the payload", async () => {
    const { db, rows } = fakeDb();
    const result = await handleGuardOutcomesPayload({
      params: { provider: "spoofed", guardOutcomes: { records: [run()] } },
      userId: "user-1",
      context: { agentId: "AGT-EXT-CLAUDE" },
      db,
    });
    expect(result).toMatchObject({ success: true, data: { acknowledged: [RUN_ID], refused: [] } });
    expect(rows[0]).toMatchObject({
      actorUserId: "user-1",
      provider: "AGT-EXT-CLAUDE",
      recordedByAgentId: "AGT-EXT-CLAUDE",
      operationType: "guard-outcome.run",
    });
  });

  it("refuses a malformed payload without writing", async () => {
    const { db, rows } = fakeDb();
    const notObject = await handleGuardOutcomesPayload({ params: { guardOutcomes: [] }, userId: "u", db });
    const empty = await handleGuardOutcomesPayload({ params: { guardOutcomes: { records: [] } }, userId: "u", db });
    expect(notObject).toMatchObject({ success: false, error: "invalid_guard_outcomes" });
    expect(empty).toMatchObject({ success: false, message: "records must be a non-empty array" });
    expect(rows).toEqual([]);
  });
});
