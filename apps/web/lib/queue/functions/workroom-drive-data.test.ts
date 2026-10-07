// workroom-drive-data.ts loaders, against an injected $queryRaw (GPP Phase 3c
// PR-3c-1, BI-8875C9DF). Plan: docs/superpowers/plans/
// 2026-10-02-gpp-phase-3c-drive-graph-execution.md (PR-3c-1,
// workroom-drive-data.ts). No test file existed for this module before.

import { describe, expect, it } from "vitest";

import { loadRecordedEvidence, loadStageDispatchTimesByStage } from "./workroom-drive-data";

function fakeDb<T>(rows: T[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    db: {
      $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: parts.join("?"), values });
        return rows;
      },
    } as never,
  };
}

describe("loadRecordedEvidence", () => {
  it("selects the stage decision's choice from payload.result.choice and maps it onto the evidence", async () => {
    const recordedAt = new Date("2026-10-01T10:00:00.000Z");
    const { db, calls } = fakeDb([
      { capsuleId: "WC-1", stageKey: "decide", evidenceKind: "decision-record", outcome: "completed", choice: "defer", recordedAt },
      { capsuleId: "WC-1", stageKey: "sweep", evidenceKind: "assurance-run", outcome: "completed", choice: null, recordedAt },
    ]);
    const byRoom = await loadRecordedEvidence(["WC-1"], db);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/a\."payload" #>> '\{result,choice\}'\s+AS "choice"/);
    expect(calls[0]!.sql).toMatch(/a\."payload" ->> 'stageKey'\s+AS "stageKey"/);
    expect(calls[0]!.sql).toMatch(/a\."payload" ->> 'kind'\s+AS "evidenceKind"/);
    expect(calls[0]!.sql).toMatch(/a\."payload" ->> 'outcome'\s+AS "outcome"/);
    expect(calls[0]!.sql).toMatch(/LIMIT 500/);
    expect(calls[0]!.values).toEqual([["WC-1"]]);
    expect(byRoom.get("WC-1")).toEqual([
      { stageKey: "decide", kind: "decision-record", outcome: "completed", recordedAt, choice: "defer" },
      { stageKey: "sweep", kind: "assurance-run", outcome: "completed", recordedAt, choice: null },
    ]);
  });

  it("reads nothing for no rooms", async () => {
    const { db, calls } = fakeDb([]);
    expect(await loadRecordedEvidence([], db)).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });

  it("a failed read earns nothing rather than throwing", async () => {
    const db = { $queryRaw: async () => { throw new Error("db down"); } } as never;
    expect(await loadRecordedEvidence(["WC-1"], db)).toEqual(new Map());
  });
});

describe("loadStageDispatchTimesByStage", () => {
  it("reads graph rooms only, per stage, from dispatchedStageKeys and the pending governed decisions", async () => {
    const at = (iso: string) => new Date(iso);
    const { db, calls } = fakeDb([
      { capsuleId: "WC-1", stageKey: "linux", dispatchedAt: at("2026-10-01T10:00:00.000Z") },
      { capsuleId: "WC-1", stageKey: "macos", dispatchedAt: at("2026-10-01T10:15:00.000Z") },
      { capsuleId: "WC-2", stageKey: "approve", dispatchedAt: at("2026-10-01T11:00:00.000Z") },
    ]);
    const byRoom = await loadStageDispatchTimesByStage(["WC-1", "WC-2"], db);
    const sql = calls[0]!.sql;
    expect(sql).toMatch(/workroomDrive,marking/);
    expect(sql).toMatch(/'dispatchedStageKeys'/);
    expect(sql).toMatch(/'pendingAttentions'/);
    expect(sql).toMatch(/'governed_decision'/);
    // PR-3c-2: a mixed tick's row records the aggregate action, so a row naming dispatched stages counts whatever its
    // action, and a waiting governed decision is read off dispatch rows as well as attention rows.
    expect(sql).toMatch(/action' = 'dispatch_agent' OR jsonb_typeof\(a\."payload" -> 'dispatchedStageKeys'\) = 'array'/);
    expect(sql).toMatch(/"kind" IN \('workroom-drive-attention', 'workroom-drive'\)/);
    expect(sql).toMatch(/DISTINCT ON \(started\."capsuleId", started\."stageKey"\)/);
    expect(calls[0]!.values).toEqual([["WC-1", "WC-2"], ["WC-1", "WC-2"]]);
    expect(byRoom.get("WC-1")).toEqual(new Map([["linux", at("2026-10-01T10:00:00.000Z")], ["macos", at("2026-10-01T10:15:00.000Z")]]));
    expect(byRoom.get("WC-2")).toEqual(new Map([["approve", at("2026-10-01T11:00:00.000Z")]]));
  });

  it("reads nothing for no rooms", async () => {
    const { db, calls } = fakeDb([]);
    expect(await loadStageDispatchTimesByStage([], db)).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });
});
