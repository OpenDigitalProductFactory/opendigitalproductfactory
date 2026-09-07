// Stage advance (BI-76B35820).
//
// Measured before this: twelve rooms dispatching every 15 minutes, 48 completed
// task runs, and COUNT(DISTINCT stageKey) = 1 on every one of them.
// WC-A69BCABB ran `sweep` five times and never reached `raise` or `decide`.
// Receipts were read in three places and written in none.

import { describe, expect, it } from "vitest";

import {
  STAGE_COMPLETION_RECEIPT_KIND,
  carryReceipts,
  earnStageReceipts,
  stageRunCompleted,
  workroomStageTaskTitle,
} from "./stage-receipts";

const run = (stage: string, status = "completed") => ({
  title: workroomStageTaskTitle("WC-A69BCABB", stage),
  status,
});

describe("workroomStageTaskTitle", () => {
  it("matches the title the dispatcher writes", () => {
    // The observed live value. If this drifts from the dispatcher, stages stop
    // advancing silently — the whole defect, reintroduced.
    expect(workroomStageTaskTitle("WC-A69BCABB", "sweep")).toBe("Workroom WC-A69BCABB / sweep");
  });
});

describe("stageRunCompleted", () => {
  it("sees the current stage's completed run", () => {
    expect(
      stageRunCompleted({ capsuleId: "WC-A69BCABB", currentStageKey: "sweep", runs: [run("sweep")] }),
    ).toBe(true);
  });

  it("does not count a FAILED run as completion", () => {
    // A failure must re-dispatch, not advance. Laundering a failure into
    // progress would move the room past work that never happened.
    expect(
      stageRunCompleted({
        capsuleId: "WC-A69BCABB",
        currentStageKey: "sweep",
        runs: [run("sweep", "failed")],
      }),
    ).toBe(false);
  });

  it("does not count a still-working run", () => {
    expect(
      stageRunCompleted({
        capsuleId: "WC-A69BCABB",
        currentStageKey: "sweep",
        runs: [run("sweep", "working")],
      }),
    ).toBe(false);
  });

  it("does not count another stage's completion", () => {
    expect(
      stageRunCompleted({ capsuleId: "WC-A69BCABB", currentStageKey: "sweep", runs: [run("raise")] }),
    ).toBe(false);
  });

  it("does not count another room's run of the same stage name", () => {
    const otherRoom = { title: workroomStageTaskTitle("WC-OTHER", "sweep"), status: "completed" };
    expect(
      stageRunCompleted({ capsuleId: "WC-A69BCABB", currentStageKey: "sweep", runs: [otherRoom] }),
    ).toBe(false);
  });
});

describe("earnStageReceipts", () => {
  it("records a receipt so the stage can advance", () => {
    const receipts = earnStageReceipts({
      capsuleId: "WC-A69BCABB",
      currentStageKey: "sweep",
      runs: [run("sweep")],
      existing: [],
    });
    expect(receipts).toEqual([{ stageKey: "sweep", kind: STAGE_COMPLETION_RECEIPT_KIND }]);
  });

  it("is idempotent — five completed sweeps do not make five receipts", () => {
    const existing = [{ stageKey: "sweep", kind: STAGE_COMPLETION_RECEIPT_KIND }];
    const receipts = earnStageReceipts({
      capsuleId: "WC-A69BCABB",
      currentStageKey: "sweep",
      runs: [run("sweep"), run("sweep")],
      existing,
    });
    expect(receipts).toBe(existing);
  });

  it("returns the same reference when nothing was earned, so no write is needed", () => {
    const existing: Array<{ stageKey: string; kind: string }> = [];
    expect(
      earnStageReceipts({
        capsuleId: "WC-A69BCABB",
        currentStageKey: "sweep",
        runs: [run("sweep", "failed")],
        existing,
      }),
    ).toBe(existing);
  });

  it("earns nothing when the room has no current stage", () => {
    const existing: Array<{ stageKey: string; kind: string }> = [];
    expect(
      earnStageReceipts({ capsuleId: "WC-A69BCABB", currentStageKey: null, runs: [run("sweep")], existing }),
    ).toBe(existing);
  });
});

describe("carryReceipts", () => {
  it("keeps receipts within the same cycle", () => {
    const receipts = [{ stageKey: "sweep", kind: STAGE_COMPLETION_RECEIPT_KIND }];
    expect(
      carryReceipts({ receipts, previousCycleKey: "s@1.0.0:2026-09-06", currentCycleKey: "s@1.0.0:2026-09-06" }),
    ).toBe(receipts);
  });

  it("clears them when the cycle rolls, so tomorrow's run does not skip every stage", () => {
    // The same defect inverted: a daily watch would run once and then satisfy
    // every stage forever from yesterday's receipts.
    expect(
      carryReceipts({
        receipts: [{ stageKey: "sweep", kind: STAGE_COMPLETION_RECEIPT_KIND }],
        previousCycleKey: "s@1.0.0:2026-09-06",
        currentCycleKey: "s@1.0.0:2026-09-07",
      }),
    ).toEqual([]);
  });

  it("keeps receipts when either cycle key is unknown rather than discarding progress", () => {
    const receipts = [{ stageKey: "sweep", kind: STAGE_COMPLETION_RECEIPT_KIND }];
    expect(carryReceipts({ receipts, previousCycleKey: null, currentCycleKey: "s:1" })).toBe(receipts);
    expect(carryReceipts({ receipts, previousCycleKey: "s:1", currentCycleKey: null })).toBe(receipts);
  });
});
