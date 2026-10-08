// BI-853120EE — the sequential run resolution and the run-keyed merge, pure.
// The runner-level proof is workroom-drive-run-scope.test.ts; this pins the
// deploy-time cases for rooms written before run keys existed.

import { describe, expect, it } from "vitest";

import { resolveSequentialRun, sequentialRunFor } from "./drive-sequential-run";
import { mergeWorkroomDriveSnapshot } from "./workroom-drive-snapshot-merge";
import { driveRunKeyOf } from "./workroom-drive-state";

const CADENCE = { triggers: ["cadence" as const] };
const CLAIM = { triggers: ["claim" as const] };
const DAY1 = "credential-hygiene-watch@1.0.0:2026-10-05";
const DAY2 = "credential-hygiene-watch@1.0.0:2026-10-06";
const LEGACY_RECEIPTS = [{ stageKey: "scan", kind: "stage-evidence-recorded" }, { stageKey: "rotate", kind: "stage-evidence-recorded" }];

describe("resolveSequentialRun", () => {
  it("a legacy snapshot (no run key) that concluded on an earlier cycle starts a new run with no receipts", () => {
    const run = resolveSequentialRun({
      definition: CADENCE, cycleKey: DAY2,
      workspaceState: { workroomDrive: { action: "stop", reason: "success", lastCycleKey: DAY1, receipts: LEGACY_RECEIPTS } },
      prior: { action: "stop", reason: "success", stageKey: null, cycleKey: DAY1 },
      receipts: LEGACY_RECEIPTS,
    });
    expect(run).toEqual({ runKey: DAY2, newRun: true, receipts: [] });
  });

  it("a legacy snapshot still in flight adopts its lastCycleKey and keeps its receipts, stamped", () => {
    const run = resolveSequentialRun({
      definition: CADENCE, cycleKey: DAY2,
      workspaceState: { workroomDrive: { action: "attention", reason: "governed_decision", stageKey: "rotate", lastCycleKey: DAY1 } },
      prior: { action: "attention", reason: "governed_decision", stageKey: "rotate", cycleKey: DAY1 },
      receipts: [{ stageKey: "scan", kind: "stage-evidence-recorded" }, { stageKey: "rotate", kind: "blocked" }],
    });
    expect(run).toEqual({
      runKey: DAY1,
      newRun: false,
      receipts: [
        { stageKey: "scan", kind: "stage-evidence-recorded", runKey: DAY1 },
        { stageKey: "rotate", kind: "blocked", runKey: DAY1 },
      ],
    });
  });

  it("a room with no prior tick adopts this cycle key and keeps what it holds", () => {
    const run = resolveSequentialRun({ definition: CADENCE, cycleKey: DAY2, workspaceState: {}, prior: null, receipts: [{ stageKey: "scan", kind: "x" }] });
    expect(run).toEqual({ runKey: DAY2, newRun: false, receipts: [{ stageKey: "scan", kind: "x", runKey: DAY2 }] });
  });

  it("a stored run continues across midnight and drops a receipt of another run", () => {
    const run = resolveSequentialRun({
      definition: CADENCE, cycleKey: DAY2,
      workspaceState: { workroomDrive: { action: "dispatch_agent", reason: "agent_stage", runKey: DAY1, lastCycleKey: DAY1 } },
      prior: { action: "dispatch_agent", reason: "agent_stage", stageKey: "scan", cycleKey: DAY1 },
      receipts: [{ stageKey: "scan", kind: "a", runKey: DAY1 }, { stageKey: "rotate", kind: "b", runKey: "credential-hygiene-watch@1.0.0:2026-10-01" }],
    });
    expect(run).toEqual({ runKey: DAY1, newRun: false, receipts: [{ stageKey: "scan", kind: "a", runKey: DAY1 }] });
  });

  it("a conformance pause, escalation or stop does not conclude a run", () => {
    for (const [action, reason] of [["pause", "conformance_pause"], ["escalate", "conformance_escalate"], ["stop", "conformance_stop"]] as const) {
      const run = resolveSequentialRun({
        definition: CADENCE, cycleKey: DAY2,
        workspaceState: { workroomDrive: { action, reason, runKey: DAY1, lastCycleKey: DAY1 } },
        prior: { action, reason, stageKey: null, cycleKey: DAY1 },
        receipts: [{ stageKey: "scan", kind: "a", runKey: DAY1 }],
      });
      expect(run.newRun, reason).toBe(false);
      expect(run.receipts, reason).toHaveLength(1);
    }
  });

  it("a claim-triggered shape never starts a second run (WWMD DI-8DCB9A4B566C)", () => {
    const run = resolveSequentialRun({
      definition: CLAIM, cycleKey: DAY2,
      workspaceState: { workroomDrive: { action: "do_not_wake", reason: "cycle_complete", runKey: DAY1, lastCycleKey: DAY1 } },
      prior: { action: "do_not_wake", reason: "cycle_complete", stageKey: null, cycleKey: DAY1 },
      receipts: [],
    });
    expect(run).toMatchObject({ runKey: DAY1, newRun: false });
  });

  it("does not start a second run on the cycle key a run concluded on", () => {
    const run = resolveSequentialRun({
      definition: CADENCE, cycleKey: DAY2,
      workspaceState: { workroomDrive: { action: "stop", reason: "success", runKey: DAY1, lastCycleKey: DAY2 } },
      prior: { action: "stop", reason: "success", stageKey: null, cycleKey: DAY2 },
      receipts: [],
    });
    expect(run).toMatchObject({ runKey: DAY1, newRun: false });
  });
});

describe("sequentialRunFor", () => {
  it("is null for a graph room, whose marking carries its run", () => {
    expect(sequentialRunFor({ shape: null, workspaceState: { workroomDrive: { marking: { format: "drive-marking/1", cycleKey: DAY1, tokens: [] } } }, now: new Date(), prior: null, receipts: [] })).toBeNull();
  });

  it("keeps the stored run key when the shape does not resolve this tick", () => {
    expect(sequentialRunFor({ shape: null, workspaceState: { workroomDrive: { runKey: DAY1 } }, now: new Date(), prior: null, receipts: [] }))
      .toEqual({ runKey: DAY1, newRun: false, receipts: [] });
    expect(sequentialRunFor({ shape: null, workspaceState: {}, now: new Date(), prior: null, receipts: [] })).toBeNull();
  });
});

describe("driveRunKeyOf", () => {
  it("reads a graph marking's cycle key first, else a sequential run key", () => {
    expect(driveRunKeyOf({ marking: { cycleKey: "g" }, runKey: "s" })).toBe("g");
    expect(driveRunKeyOf({ runKey: "s" })).toBe("s");
    expect(driveRunKeyOf({ lastCycleKey: "c" })).toBeNull();
    expect(driveRunKeyOf(null)).toBeNull();
  });
});

describe("mergeWorkroomDriveSnapshot on a sequential run (BI-853120EE)", () => {
  const row = (drive: Record<string, unknown>) => ({ workroomDrive: drive });

  it("keeps a same-run receipt across midnight", () => {
    const merged = mergeWorkroomDriveSnapshot(
      row({ runKey: DAY1, lastCycleKey: DAY1, receipts: [{ stageKey: "scan", kind: "r", runKey: DAY1 }] }),
      { runKey: DAY1, lastCycleKey: DAY2, receipts: [] },
    );
    expect(merged.receipts).toEqual([{ stageKey: "scan", kind: "r", runKey: DAY1 }]);
  });

  it("never merges the concluded run's receipts into a new run, even on the same calendar key", () => {
    const merged = mergeWorkroomDriveSnapshot(
      row({ runKey: DAY1, lastCycleKey: DAY2, receipts: [{ stageKey: "scan", kind: "r", runKey: DAY1 }] }),
      { runKey: DAY2, lastCycleKey: DAY2, receipts: [] },
    );
    expect(merged.receipts).toEqual([]);
  });

  it("falls back to lastCycleKey when either side has no run key, and a receipt merged into a run is stamped with it", () => {
    const merged = mergeWorkroomDriveSnapshot(
      row({ lastCycleKey: DAY1, receipts: [{ stageKey: "scan", kind: "r" }] }),
      { runKey: DAY1, lastCycleKey: DAY1, receipts: [] },
    );
    expect(merged.receipts).toEqual([{ stageKey: "scan", kind: "r", runKey: DAY1 }]);
    const unkeyed = mergeWorkroomDriveSnapshot(
      row({ lastCycleKey: DAY1, receipts: [{ stageKey: "scan", kind: "r" }] }),
      { lastCycleKey: DAY1, receipts: [] },
    );
    expect(unkeyed.receipts).toEqual([{ stageKey: "scan", kind: "r" }]);
  });

  it("a stamped row receipt deduplicates against the run's own copy", () => {
    const merged = mergeWorkroomDriveSnapshot(
      row({ runKey: DAY1, lastCycleKey: DAY1, receipts: [{ stageKey: "scan", kind: "r" }] }),
      { runKey: DAY1, lastCycleKey: DAY1, receipts: [{ stageKey: "scan", kind: "r", runKey: DAY1 }] },
    );
    expect(merged.receipts).toEqual([{ stageKey: "scan", kind: "r", runKey: DAY1 }]);
  });
});
