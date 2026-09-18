// A fail-closed pause must not be a permanent lock (BI-WRITEBACK-LATCH).
//
// #5166 correctly stopped the re-dispatch loop: a stage that produced no
// completing receipt pauses instead of being dispatched again every 15 minutes.
// But the latch is self-sustaining —
//
//   alreadyTriedWriteback = ... || prior.reason === EXECUTOR_WRITEBACK_UNAVAILABLE
//
// — so once a room pauses for this reason, the NEXT tick sees that same reason
// and pauses again, forever. The only exit is a completing receipt, which can
// never arrive because the room never dispatches again to produce one.
//
// Observed on this install: 12 of 24 rooms locked on
// executor_writeback_unavailable, unable to recover even after the defect that
// caused the empty writeback was fixed and deployed. A deploy that fixes the
// cause cannot reach a room that will not try again.
//
// The fix keeps the capacity protection and bounds the retry: the latch holds
// WITHIN a cycle, and a new cycle grants one fresh attempt. That is one attempt
// per day per room instead of the 96 the guard was built to stop.

import { describe, expect, it } from "vitest";

import { writebackLatchHolds } from "./writeback-latch";

const CYCLE_A = "dependency-advisory-watch@1.0.0:2026-09-08";
const CYCLE_B = "dependency-advisory-watch@1.0.0:2026-09-09";

describe("writebackLatchHolds", () => {
  it("holds within the same cycle after a dispatch produced no receipt", () => {
    // The behaviour #5166 added, preserved exactly.
    expect(
      writebackLatchHolds({
        prior: { action: "dispatch_agent", reason: "agent_stage", stageKey: "sweep", cycleKey: CYCLE_A },
        stageKey: "sweep",
        currentCycleKey: CYCLE_A,
        blocked: false,
      }),
    ).toBe(true);
  });

  it("holds within the same cycle after a previous writeback pause", () => {
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "sweep",
          cycleKey: CYCLE_A,
        },
        stageKey: "sweep",
        currentCycleKey: CYCLE_A,
        blocked: false,
      }),
    ).toBe(true);
  });

  it("RELEASES on a new cycle, so a deployed fix can actually reach the room", () => {
    // The defect this closes. Without it, twelve rooms stay locked forever and
    // no amount of fixing the executor helps.
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "sweep",
          cycleKey: CYCLE_A,
        },
        stageKey: "sweep",
        currentCycleKey: CYCLE_B,
        blocked: false,
      }),
    ).toBe(false);
  });

  it("still holds on a new cycle when the stage carries a blocked receipt", () => {
    // A recorded `blocked` receipt is a deliberate, durable statement about THIS
    // stage — stronger than the prior-tick heuristic, and not time-bounded.
    expect(
      writebackLatchHolds({
        prior: null,
        stageKey: "sweep",
        currentCycleKey: CYCLE_B,
        blocked: true,
      }),
    ).toBe(true);
  });

  it("does not latch on a different stage's prior attempt", () => {
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "raise",
          cycleKey: CYCLE_A,
        },
        stageKey: "sweep",
        currentCycleKey: CYCLE_A,
        blocked: false,
      }),
    ).toBe(false);
  });

  it("does not latch with no prior drive at all", () => {
    expect(
      writebackLatchHolds({ prior: null, stageKey: "sweep", currentCycleKey: CYCLE_A, blocked: false }),
    ).toBe(false);
  });

  it("holds when the cycle key is unknown, preferring the safe side", () => {
    // An unknown cycle must not be read as "a new cycle" and silently re-open
    // the loop the guard exists to prevent.
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "sweep",
          cycleKey: null,
        },
        stageKey: "sweep",
        currentCycleKey: null,
        blocked: false,
      }),
    ).toBe(true);
  });

  it("does not latch after a prior tick that neither dispatched nor blocked", () => {
    expect(
      writebackLatchHolds({
        prior: { action: "pause", reason: "conformance_pause", stageKey: "sweep", cycleKey: CYCLE_A },
        stageKey: "sweep",
        currentCycleKey: CYCLE_A,
        blocked: false,
      }),
    ).toBe(false);
  });
});

// ─── End-to-end release, through the real resolver ───────────────────────────
//
// The unit tests above exercise the predicate. This one proves the wiring: a
// room latched in a previous cycle actually dispatches again through
// resolveDrivePlan. Without it the predicate could be correct and unreachable —
// the failure mode this codebase keeps producing.

describe("the latch releases through resolveDrivePlan", () => {
  it("re-dispatches a room whose writeback pause belongs to an earlier cycle", async () => {
    const { resolveDrivePlan } = await import("./drive-resolution");
    const { STANDING_SHAPES } = await import("./standing-operations-shapes");
    const { readWorkShapeDefinitionContract } = await import("./work-shapes");
    const shape = STANDING_SHAPES["dependency-advisory-watch"];
    const definition = readWorkShapeDefinitionContract(shape);

    const base = {
      roomId: "WC-A69BCABB",
      definition,
      postureLevel: "balanced" as const,
      collaborationShape: shape.collaborationShape ?? null,
      participants: [
        {
          workroomId: "r1",
          principalRef: "PRN-SEC",
          displayName: "security-engineer",
          kind: "agent" as const,
          roles: ["coordinator"],
          assignmentSource: "explicit",
          coordinatorSource: "explicit" as const,
          enteredReason: null,
          currentWorkSummary: null,
          sponsorPrincipalRef: null,
          sponsorDisplayName: null,
          authoritySummary: "",
        },
      ],
      currentStageKey: "sweep",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      substrateReachable: true,
      substrateEmpty: false,
      coordinatorEligibility: { jsi: "not-applicable" as const, authorityBinding: "eligible" as const },
      now: new Date("2026-09-09T10:00:00Z"),
    };

    const stuck = resolveDrivePlan({
      ...base,
      priorDrive: {
        action: "pause",
        reason: "executor_writeback_unavailable",
        stageKey: "sweep",
        cycleKey: "dependency-advisory-watch@1.0.0:2026-09-09",
      },
    } as never);
    expect(stuck.reason).toBe("executor_writeback_unavailable");

    const released = resolveDrivePlan({
      ...base,
      priorDrive: {
        action: "pause",
        reason: "executor_writeback_unavailable",
        stageKey: "sweep",
        // Yesterday. This is the twelve locked rooms on this install.
        cycleKey: "dependency-advisory-watch@1.0.0:2026-09-08",
      },
    } as never);
    expect(released.reason).not.toBe("executor_writeback_unavailable");
  });
});

// ─── A blocked receipt is cycle-scoped too ───────────────────────────────────
//
// Found on the live install AFTER the bounded latch deployed. The cycle rolled
// (stored lastCycleKey 2026-09-08, current 2026-09-09) and the rooms stayed
// locked anyway, because every one of them carries:
//
//   [{"kind": "blocked", "stageKey": "sweep"}]
//
// and the first version of this function returned true unconditionally on that,
// before any cycle comparison. The reasoning was that a recorded receipt is a
// durable statement rather than a prior-tick inference — which preserved the
// exact deadlock the bounded latch was written to remove, for exactly the twelve
// rooms that were already stuck.
//
// A blocked receipt records "this stage produced no writeback in THIS cycle".
// It is not a finding that the stage is permanently unfit.

describe("a blocked receipt does not outlive its cycle", () => {
  const CYCLE_YESTERDAY = "dependency-advisory-watch@1.0.0:2026-09-08";
  const CYCLE_TODAY = "dependency-advisory-watch@1.0.0:2026-09-09";

  it("holds inside the cycle that recorded it", () => {
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "sweep",
          cycleKey: CYCLE_TODAY,
        },
        stageKey: "sweep",
        currentCycleKey: CYCLE_TODAY,
        blocked: true,
      }),
    ).toBe(true);
  });

  it("RELEASES on the next cycle — the live case that stayed locked", () => {
    expect(
      writebackLatchHolds({
        prior: {
          action: "pause",
          reason: "executor_writeback_unavailable",
          stageKey: "sweep",
          cycleKey: CYCLE_YESTERDAY,
        },
        stageKey: "sweep",
        currentCycleKey: CYCLE_TODAY,
        blocked: true,
      }),
    ).toBe(false);
  });

  it("still holds when the cycle cannot be determined", () => {
    // Unknown must never be read as "a new cycle"; that re-opens the loop.
    expect(
      writebackLatchHolds({
        prior: { action: "pause", reason: "executor_writeback_unavailable", stageKey: "sweep", cycleKey: null },
        stageKey: "sweep",
        currentCycleKey: CYCLE_TODAY,
        blocked: true,
      }),
    ).toBe(true);
    expect(
      writebackLatchHolds({ prior: null, stageKey: "sweep", currentCycleKey: CYCLE_TODAY, blocked: true }),
    ).toBe(true);
  });

  it("does not let another stage's blocked receipt hold this stage", () => {
    expect(
      writebackLatchHolds({
        prior: { action: "pause", reason: "executor_writeback_unavailable", stageKey: "raise", cycleKey: CYCLE_TODAY },
        stageKey: "sweep",
        currentCycleKey: CYCLE_TODAY,
        blocked: true,
      }),
    ).toBe(false);
  });
});

// ─── The live state, through the real resolver ───────────────────────────────
//
// Reproduces WC-A69BCABB exactly as the database held it on 2026-09-09:
//   receipts     [{"kind":"blocked","stageKey":"sweep"}]
//   lastCycleKey dependency-advisory-watch@1.0.0:2026-09-08
//   reason       executor_writeback_unavailable
// and asserts it dispatches. The predicate tests above would all have passed
// while this room stayed locked, which is how the first fix shipped believing
// itself complete.

describe("the twelve locked rooms, reproduced", () => {
  it("dispatches WC-A69BCABB from its real stored state", async () => {
    const { resolveDrivePlan } = await import("./drive-resolution");
    const { STANDING_SHAPES } = await import("./standing-operations-shapes");
    const { readWorkShapeDefinitionContract } = await import("./work-shapes");
    const shape = STANDING_SHAPES["dependency-advisory-watch"];

    const plan = resolveDrivePlan({
      roomId: "WC-A69BCABB",
      definition: readWorkShapeDefinitionContract(shape),
      collaborationShape: shape.collaborationShape ?? null,
      postureLevel: "balanced" as const,
      participants: [
        {
          workroomId: "r1",
          principalRef: "PRN-SEC",
          displayName: "security-engineer",
          kind: "agent" as const,
          roles: ["coordinator"],
          assignmentSource: "explicit",
          coordinatorSource: "explicit" as const,
          enteredReason: null,
          currentWorkSummary: null,
          sponsorPrincipalRef: null,
          sponsorDisplayName: null,
          authoritySummary: "",
        },
      ],
      currentStageKey: "sweep",
      // The live rows, verbatim.
      receipts: [{ stageKey: "sweep", kind: "blocked" }],
      priorDrive: {
        action: "pause",
        reason: "executor_writeback_unavailable",
        stageKey: "sweep",
        cycleKey: "dependency-advisory-watch@1.0.0:2026-09-08",
      },
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      substrateReachable: true,
      substrateEmpty: false,
      coordinatorEligibility: { jsi: "not-applicable" as const, authorityBinding: "eligible" as const },
      now: new Date("2026-09-09T10:00:00Z"),
    } as never);

    expect(plan.reason).not.toBe("executor_writeback_unavailable");
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.stageKey).toBe("sweep");
  });
});
