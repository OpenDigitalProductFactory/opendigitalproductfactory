import { describe, expect, it } from "vitest";

import {
  buildWithdrawnHumanOutcome,
  isWithdrawnHumanOutcome,
  selectWithdrawableDecisions,
  SYSTEM_WITHDRAWAL_RESOLVER,
  type DecisionResidueRow,
} from "./decision-residue-staleness";

function row(overrides: Partial<DecisionResidueRow> = {}): DecisionResidueRow {
  return {
    interactionId: "DI-TEST000001",
    outcomeType: "escalate",
    buildId: "FB-TEST0001",
    buildPhase: "ideate",
    buildSupersededByEpicId: null,
    backlogItemStatus: "in-progress",
    backlogItemTriageOutcome: "build",
    ...overrides,
  };
}

describe("selectWithdrawableDecisions", () => {
  it("withdraws residue whose build was abandoned — the BI-FE034C1E case", () => {
    // The live reproduction: DI-58465A1C784B escalated on FB-1DB2A3B5, which was
    // then abandoned. The card kept claiming the build "stays blocked".
    const result = selectWithdrawableDecisions([
      row({ interactionId: "DI-58465A1C784B", buildId: "FB-1DB2A3B5", buildPhase: "abandoned" }),
    ]);

    expect(result).toEqual([
      { interactionId: "DI-58465A1C784B", reason: "originating-build-abandoned" },
    ]);
  });

  it("keeps residue whose build is still in flight", () => {
    for (const phase of ["ideate", "plan", "build", "review", "ship"]) {
      expect(selectWithdrawableDecisions([row({ buildPhase: phase })])).toEqual([]);
    }
  });

  it("keeps residue for a panicked build — a live, recoverable stall", () => {
    expect(selectWithdrawableDecisions([row({ buildPhase: "panicked" })])).toEqual([]);
  });

  it("withdraws residue whose build shipped or died", () => {
    expect(selectWithdrawableDecisions([row({ buildPhase: "complete" })])).toEqual([
      { interactionId: "DI-TEST000001", reason: "originating-build-finished" },
    ]);
    expect(selectWithdrawableDecisions([row({ buildPhase: "failed" })])).toEqual([
      { interactionId: "DI-TEST000001", reason: "originating-build-finished" },
    ]);
  });

  it("withdraws residue whose build was superseded by an approved decompose", () => {
    expect(
      selectWithdrawableDecisions([row({ buildSupersededByEpicId: "EP-TEST0001" })]),
    ).toEqual([{ interactionId: "DI-TEST000001", reason: "build-superseded-by-epic" }]);
  });

  it("withdraws residue on a live build whose originating item shipped", () => {
    expect(selectWithdrawableDecisions([row({ backlogItemStatus: "done" })])).toEqual([
      { interactionId: "DI-TEST000001", reason: "originating-item-done" },
    ]);
  });

  it("withdraws residue whose originating item will not be done", () => {
    for (const triageOutcome of ["discard", "duplicate"]) {
      expect(
        selectWithdrawableDecisions([row({ backlogItemTriageOutcome: triageOutcome })]),
      ).toEqual([{ interactionId: "DI-TEST000001", reason: "originating-item-wont-do" }]);
    }
  });

  it("keeps residue for an item deferred but still wanted", () => {
    // `deferred` spans parked-and-wanted vs discarded, so staleness must key off
    // triageOutcome — same rule as escalation-staleness.ts.
    expect(
      selectWithdrawableDecisions([
        row({ backlogItemStatus: "deferred", backlogItemTriageOutcome: "build" }),
      ]),
    ).toEqual([]);
  });

  it("never withdraws a decision that is not build-linked", () => {
    // Org-business and profession gate rows are answered by a human at
    // /coworker-decisions/review; the sweep must not touch them even when the
    // joined build fields would otherwise look terminal.
    expect(
      selectWithdrawableDecisions([
        row({ buildId: null, buildPhase: "abandoned", backlogItemStatus: "done" }),
      ]),
    ).toEqual([]);
  });

  it("sweeps a mixed batch, withdrawing only the provably dead rows", () => {
    const result = selectWithdrawableDecisions([
      row({ interactionId: "DI-DEAD000001", buildPhase: "abandoned" }),
      row({ interactionId: "DI-LIVE000001", buildPhase: "build" }),
      row({ interactionId: "DI-ORG0000001", buildId: null }),
      row({ interactionId: "DI-DEAD000002", buildPhase: "complete" }),
    ]);

    expect(result.map((r) => r.interactionId)).toEqual(["DI-DEAD000001", "DI-DEAD000002"]);
  });

  it("returns nothing for an empty batch", () => {
    expect(selectWithdrawableDecisions([])).toEqual([]);
  });
});

describe("buildWithdrawnHumanOutcome", () => {
  const outcome = buildWithdrawnHumanOutcome({
    reason: "originating-build-abandoned",
    withdrawnAtIso: "2026-07-29T15:00:00.000Z",
  });

  it("never clears the gate", () => {
    // Paired with writing no EscalationCapture, this keeps
    // interactionWasCleared() (decision-perspective/persistence.ts) false.
    expect(outcome.clearsGate).toBe(false);
  });

  it("never becomes candidate decision material", () => {
    expect(outcome.candidateMaterial).toBe(false);
  });

  it("attributes the write to the sweep, not a person", () => {
    expect(outcome.resolvedBy).toBe(SYSTEM_WITHDRAWAL_RESOLVER);
    expect(outcome.resolverUserId).toBeNull();
  });

  it("carries no answer or rationale — nobody answered", () => {
    expect(outcome).not.toHaveProperty("answer");
    expect(outcome).not.toHaveProperty("rationale");
  });

  it("does not set chosenOptionId, so weight inference never reads it as a pick", () => {
    // weight-inference-adapter.ts selects on chosenOptionId NOT NULL.
    expect(outcome).not.toHaveProperty("chosenOptionId");
  });

  it("records the machine reason and timestamp", () => {
    expect(outcome.reason).toBe("originating-build-abandoned");
    expect(outcome.capturedAt).toBe("2026-07-29T15:00:00.000Z");
  });
});

describe("isWithdrawnHumanOutcome", () => {
  it("recognizes a withdrawal written by the sweep", () => {
    expect(
      isWithdrawnHumanOutcome(
        buildWithdrawnHumanOutcome({
          reason: "originating-build-finished",
          withdrawnAtIso: "2026-07-29T15:00:00.000Z",
        }),
      ),
    ).toBe(true);
  });

  it("does not treat a human capture as a withdrawal", () => {
    expect(
      isWithdrawnHumanOutcome({
        type: "escalation",
        answer: "Ship it.",
        resolverUserId: "user_1",
        clearsGate: true,
      }),
    ).toBe(false);
  });

  it("does not accept a withdrawal-shaped payload from another writer", () => {
    // The resolver marker is what makes the claim trustworthy, not the type alone.
    expect(isWithdrawnHumanOutcome({ type: "withdrawn" })).toBe(false);
    expect(
      isWithdrawnHumanOutcome({ type: "withdrawn", resolvedBy: "user_1" }),
    ).toBe(false);
  });

  it("is safe on null, primitives, and arrays", () => {
    expect(isWithdrawnHumanOutcome(null)).toBe(false);
    expect(isWithdrawnHumanOutcome(undefined)).toBe(false);
    expect(isWithdrawnHumanOutcome("withdrawn")).toBe(false);
    expect(isWithdrawnHumanOutcome([{ type: "withdrawn" }])).toBe(false);
  });
});
