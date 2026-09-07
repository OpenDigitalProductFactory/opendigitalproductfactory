import { describe, expect, it } from "vitest";

import { WORK_CASE_ACTION_REGISTRY } from "./action-registry";
import {
  GATE_DENIAL_CONTRACT,
  GATE_SHAPING_DEFAULT,
  gateDenialContract,
  shapingAffordance,
  shapingBudgetFor,
  type GateDenialReason,
} from "./gate-shaping";
import { evaluateWorkCasePolicy } from "./policy-envelope";

describe("the classification is exhaustive by construction", () => {
  // The compiler enforces this — `Record<GateDenialReason, …>` will not build
  // with a reason missing. This test states the intent so the next person
  // reading the map knows the omission was impossible, not merely unlikely.
  it("classifies every denial reason the gate can return", () => {
    const reasons = Object.keys(GATE_DENIAL_CONTRACT) as GateDenialReason[];
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(["shape", "escalate", "hard-no"]).toContain(GATE_DENIAL_CONTRACT[reason].disposition);
    }
  });

  it("gives every shapeable denial something concrete to change", () => {
    for (const [reason, contract] of Object.entries(GATE_DENIAL_CONTRACT)) {
      if (contract.disposition !== "shape") continue;
      expect(contract.shapeHint, `${reason} is shapeable but says nothing to change`).toBeTruthy();
    }
  });

  it("offers no shaping hint where shaping cannot help", () => {
    for (const [reason, contract] of Object.entries(GATE_DENIAL_CONTRACT)) {
      if (contract.disposition === "shape") continue;
      expect(contract.shapeHint, `${reason} is not shapeable but hints at a change`).toBeNull();
    }
  });

  it("treats an unclassified reason as needing a person, never as shapeable", () => {
    // The dangerous default is the one where a coworker loops against
    // something nobody scoped.
    expect(gateDenialContract("some_reason_from_the_future")).toEqual({
      disposition: "escalate",
      shapeHint: null,
    });
  });
});

describe("the stop rule holds", () => {
  it("keeps a tripped stop condition a hard no", () => {
    // AGENTS.md §1: an enforcement refusal is a stop, not a workaround.
    expect(GATE_DENIAL_CONTRACT.stop_condition_tripped.disposition).toBe("hard-no");
    expect(
      shapingAffordance({ action: "complete", reason: "stop_condition_tripped", attemptsSoFar: 0 }),
    ).toMatchObject({ disposition: "hard-no", escalateNow: false, attemptsRemaining: 0 });
  });

  it("keeps a sealed case sealed no matter how many attempts remain", () => {
    expect(
      shapingAffordance({ action: "complete", reason: "terminal_case_sealed", attemptsSoFar: 0 }),
    ).toMatchObject({ disposition: "hard-no" });
  });

  it("sends an unapproved envelope to a person rather than to a retry", () => {
    expect(
      shapingAffordance({
        action: "complete",
        reason: "coworker_envelope_not_approved",
        attemptsSoFar: 0,
      }),
    ).toMatchObject({ disposition: "escalate", escalateNow: true });
  });
});

describe("the shaping budget is bounded", () => {
  it("defaults every action to the platform ceiling", () => {
    for (const descriptor of WORK_CASE_ACTION_REGISTRY) {
      const budget = shapingBudgetFor(descriptor.action);
      expect(budget.maxAttempts).toBeLessThanOrEqual(GATE_SHAPING_DEFAULT.maxAttempts);
      expect(budget.maxOptions).toBeLessThanOrEqual(GATE_SHAPING_DEFAULT.maxOptions);
      expect(budget.maxAttempts).toBeGreaterThan(0);
    }
  });

  it("counts attempts down, and hands over once they are spent", () => {
    const first = shapingAffordance({
      action: "complete",
      reason: "missing_verification_evidence",
      attemptsSoFar: 0,
    });
    expect(first).toMatchObject({ disposition: "shape", escalateNow: false });
    expect(first.attemptsRemaining).toBe(GATE_SHAPING_DEFAULT.maxAttempts);
    expect(first.shapeHint).toContain("Verify");

    const last = shapingAffordance({
      action: "complete",
      reason: "missing_verification_evidence",
      attemptsSoFar: GATE_SHAPING_DEFAULT.maxAttempts,
    });
    // Exhaustion is NOT a hard no: running out of attempts says nothing about
    // whether the thing is allowed, only that this coworker could not shape it.
    expect(last).toMatchObject({ disposition: "escalate", escalateNow: true, attemptsRemaining: 0 });
    expect(last.shapeHint).toContain("Verify");
  });

  it("never lets an over-budget attempt count go negative", () => {
    expect(
      shapingAffordance({ action: "complete", reason: "missing_receipt_policy", attemptsSoFar: 99 })
        .attemptsRemaining,
    ).toBe(0);
  });
});

describe("the gate itself carries the disposition", () => {
  it("labels a real denial so the caller knows which kind of no it got", () => {
    const decision = evaluateWorkCasePolicy({
      caseRef: { caseId: "WC-1", sourceKey: "backlog-item" },
      action: "not-a-real-action" as never,
      currentState: { status: "active", terminal: false },
      envelope: { autonomyMode: "supervised" },
    } as never);

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(["shape", "escalate", "hard-no"]).toContain(decision.disposition);
  });
});
