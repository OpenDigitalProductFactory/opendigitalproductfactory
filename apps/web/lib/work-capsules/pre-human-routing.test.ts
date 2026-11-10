import { describe, expect, it } from "vitest";

import { validatePreHumanRouting } from "./pre-human-routing";

describe("validatePreHumanRouting", () => {
  it.each(["factual-clarification", "owner-consent"] as const)(
    "allows %s without inventing a decision ledger",
    (routingDisposition) => {
      expect(validatePreHumanRouting({
        status: "blocked",
        reason: routingDisposition === "owner-consent"
          ? "Owner authorization is required before publishing."
          : "The provider credential is unavailable.",
        routingDisposition,
      })).toEqual({ valid: true, disposition: routingDisposition, decisionInteractionId: null });
    },
  );

  it.each(["scope-resolved", "legitimate-escalation"] as const)(
    "requires an existing DecisionInteraction for %s",
    (routingDisposition) => {
      expect(validatePreHumanRouting({
        status: "blocked",
        reason: "The operator must choose the remaining scope.",
        routingDisposition,
      })).toEqual(expect.objectContaining({
        valid: false,
        error: "decision_interaction_required",
      }));

      expect(validatePreHumanRouting({
        status: routingDisposition === "scope-resolved" ? "working" : "blocked",
        reason: "WWMD routing recorded.",
        routingDisposition,
        decisionInteractionId: "DI-45E8FB6E767F",
      })).toEqual({
        valid: true,
        disposition: routingDisposition,
        decisionInteractionId: "DI-45E8FB6E767F",
      });
    },
  );

  it("rejects unknown dispositions and malformed ledger identifiers", () => {
    expect(validatePreHumanRouting({
      status: "blocked",
      reason: "Waiting for a choice.",
      routingDisposition: "ask-first",
    })).toEqual(expect.objectContaining({ valid: false, error: "invalid_routing_disposition" }));

    expect(validatePreHumanRouting({
      status: "working",
      reason: "WWMD routing recorded.",
      routingDisposition: "scope-resolved",
      decisionInteractionId: "not-a-ledger",
    })).toEqual(expect.objectContaining({ valid: false, error: "decision_interaction_required" }));
  });
});
