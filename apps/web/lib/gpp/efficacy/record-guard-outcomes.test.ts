import { describe, expect, it } from "vitest";

import { guardDeclarationsRowId, guardOutcomeRunRowId, sha256Hex } from "./guard-outcome-run";
import { recordGuardOutcomes, type GuardOutcomeWriteDb } from "./record-guard-outcomes";

const RUN_ID = "00000000-0000-4000-8000-000000000001";

function validRun(overrides: Record<string, unknown> = {}) {
  return {
    schema: "guard-outcome-run.v1",
    runId: RUN_ID,
    runner: "pregate",
    startedAt: "2026-10-14T00:00:00.000Z",
    durationMs: 10,
    diff: { cloneKey: "0".repeat(16), branch: "feat/x", baseSha: "a".repeat(40), headSha: "b".repeat(40), patchId: null, dirty: false },
    override: null,
    declarationsDigest: null,
    guards: [{ guardId: "loop:check-no-x", kind: "guard", guardDigest: "c".repeat(64), baselineDigest: null, verdict: "refused", durationMs: 5 }],
    ...overrides,
  };
}

/** A fake that enforces the primary key the way Postgres does. */
function fakeDb() {
  const rows = new Map<string, Record<string, unknown>>();
  const db: GuardOutcomeWriteDb = {
    externalEvidenceRecord: {
      async create({ data }) {
        const id = String(data.id);
        if (rows.has(id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        rows.set(id, data as unknown as Record<string, unknown>);
        return { id };
      },
      async findUnique({ where }) {
        const row = rows.get(where.id);
        return row
          ? { details: row.details as never, actorUserId: String(row.actorUserId), recordedByAgentId: (row.recordedByAgentId as string | undefined) ?? null }
          : null;
      },
    },
  };
  return { db, rows };
}

const caller = { actorUserId: "user-1", provider: "claude", routeContext: "external:guard-outcomes", recordedByAgentId: "AGT-EXT-CLAUDE" };

describe("recordGuardOutcomes", () => {
  it("AC-GOE-02: writes one guard-outcome.run row per run, with actor and recorder from the caller", async () => {
    const { db, rows } = fakeDb();
    const result = await recordGuardOutcomes({ ...caller, records: [validRun()] }, db);
    expect(result).toEqual({ ok: true, data: { acknowledged: [RUN_ID], refused: [], declarations: "absent" } });
    const row = rows.get(guardOutcomeRunRowId(RUN_ID));
    expect(row).toMatchObject({
      operationType: "guard-outcome.run",
      target: `${"0".repeat(16)}:feat/x`,
      actorUserId: "user-1",
      provider: "claude",
      recordedByAgentId: "AGT-EXT-CLAUDE",
      resultSummary: "pregate: 1 guard result(s), 1 refused",
    });
  });

  it("a replay with different content under the same runId is an integrity refusal, never acknowledged", async () => {
    const { db, rows } = fakeDb();
    await recordGuardOutcomes({ ...caller, records: [validRun()] }, db);
    const tampered = validRun({ durationMs: 999 });
    const result = await recordGuardOutcomes({ ...caller, records: [tampered] }, db);
    expect(result).toMatchObject({ data: { acknowledged: [], refused: [{ runId: RUN_ID, reason: "integrity-conflict", permanent: true }] } });
    expect((rows.get(guardOutcomeRunRowId(RUN_ID))?.details as { durationMs: number }).durationMs).toBe(10);
  });

  it("a replay by a different actor is an integrity refusal", async () => {
    const { db } = fakeDb();
    await recordGuardOutcomes({ ...caller, records: [validRun()] }, db);
    const result = await recordGuardOutcomes({ ...caller, actorUserId: "user-2", records: [validRun()] }, db);
    expect(result).toMatchObject({ data: { refused: [{ reason: "integrity-conflict", permanent: true }] } });
  });

  it("a repeated runId is acknowledged without a second row", async () => {
    const { db, rows } = fakeDb();
    await recordGuardOutcomes({ ...caller, records: [validRun()] }, db);
    const again = await recordGuardOutcomes({ ...caller, records: [validRun()] }, db);
    expect(again).toMatchObject({ data: { acknowledged: [RUN_ID] } });
    expect(rows.size).toBe(1);
  });

  it("refuses a malformed record with its reason and still writes the valid ones", async () => {
    const { db, rows } = fakeDb();
    const bad = validRun({ runId: "00000000-0000-4000-8000-000000000002", runner: "ci" });
    const result = await recordGuardOutcomes({ ...caller, records: [validRun(), bad] }, db);
    expect(result).toMatchObject({ data: {
      acknowledged: [RUN_ID],
      refused: [{ runId: "00000000-0000-4000-8000-000000000002", reason: "invalid: runner", permanent: true }],
    } });
    expect(rows.size).toBe(1);
  });

  it("refuses an oversized record and too many records", async () => {
    const { db } = fakeDb();
    const huge = validRun({ override: { kind: "skip-env", code: "x", reason: "y".repeat(70_000) } });
    const result = await recordGuardOutcomes({ ...caller, records: [huge] }, db);
    expect(result).toMatchObject({ data: { refused: [{ reason: "record exceeds 65536 bytes" }] } });
    const many = await recordGuardOutcomes({ ...caller, records: Array.from({ length: 21 }, () => validRun()) }, db);
    expect(many).toEqual({ ok: false, error: "at most 20 records per call" });
  });

  it("stores the declarations file once per distinct digest", async () => {
    const { db, rows } = fakeDb();
    const raw = JSON.stringify({ version: 1, guards: { "loop:check-no-x": { owner: "platform" } } });
    const first = await recordGuardOutcomes({ ...caller, records: [validRun()], declarations: raw }, db);
    const second = await recordGuardOutcomes({ ...caller, records: [validRun()], declarations: raw }, db);
    expect(first).toMatchObject({ data: { declarations: "stored" } });
    expect(second).toMatchObject({ data: { declarations: "already-stored" } });
    expect(rows.get(guardDeclarationsRowId(sha256Hex(raw)))).toMatchObject({ operationType: "guard-outcome.declarations" });
    const refused = await recordGuardOutcomes({ ...caller, records: [validRun()], declarations: "{ not json" }, db);
    expect(refused).toMatchObject({ data: { declarations: "refused" } });
  });
});
