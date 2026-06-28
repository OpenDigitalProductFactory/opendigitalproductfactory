import { describe, expect, it } from "vitest";

import {
  evaluateWorkCaseStopConditions,
  toPolicyStopConditions,
} from "./stop-conditions";

describe("Work Case stop conditions", () => {
  it("trips max-iteration, budget, timebox, approval, terminal, receipt, and policy stops", () => {
    const evaluation = evaluateWorkCaseStopConditions({
      now: "2026-06-28T12:00:00.000Z",
      conditions: [
        {
          conditionId: "iter",
          kind: "max-iterations",
          observedCount: 5,
          limit: 5,
        },
        {
          conditionId: "budget",
          kind: "budget-ceiling",
          observedAmount: 12.5,
          limit: 10,
          unit: "usd",
        },
        {
          conditionId: "timebox",
          kind: "timebox",
          deadlineAt: "2026-06-28T11:59:59.000Z",
        },
        {
          conditionId: "approval",
          kind: "required-approval",
          approvalStatus: "pending",
        },
        {
          conditionId: "terminal",
          kind: "terminal-sealed",
          terminal: true,
        },
        {
          conditionId: "receipt",
          kind: "receipt-required",
          required: true,
          satisfied: false,
        },
        {
          conditionId: "policy",
          kind: "policy-required",
          required: true,
          satisfied: false,
        },
      ],
    });

    expect(evaluation.ok).toBe(false);
    expect(evaluation.tripped.map((condition) => condition.conditionId)).toEqual([
      "iter",
      "budget",
      "timebox",
      "approval",
      "terminal",
      "receipt",
      "policy",
    ]);
    expect(evaluation.tripped[0]?.reason).toBe("Iteration count 5 reached max 5.");
  });

  it("keeps clear conditions explainable and converts trips to policy stop inputs", () => {
    const evaluation = evaluateWorkCaseStopConditions({
      now: "2026-06-28T12:00:00.000Z",
      conditions: [
        {
          conditionId: "iter",
          kind: "max-iterations",
          observedCount: 2,
          limit: 5,
        },
        {
          conditionId: "approval",
          kind: "required-approval",
          approvalStatus: "approved",
        },
      ],
    });

    expect(evaluation).toMatchObject({
      ok: true,
      tripped: [],
      clear: [
        {
          conditionId: "iter",
          kind: "max-iterations",
          reason: "Iteration count 2 is below max 5.",
        },
        {
          conditionId: "approval",
          kind: "required-approval",
          reason: "Required approval is approved.",
        },
      ],
    });
    expect(toPolicyStopConditions(evaluation)).toEqual([
      {
        stopId: "iter",
        tripped: false,
        reason: "Iteration count 2 is below max 5.",
      },
      {
        stopId: "approval",
        tripped: false,
        reason: "Required approval is approved.",
      },
    ]);
  });
});
