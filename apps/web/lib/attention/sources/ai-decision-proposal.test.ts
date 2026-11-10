import { describe, expect, it } from "vitest";

import { aiDecisionToAttentionItem, type DecisionInteractionRow } from "./ai-decision";

const ROW: DecisionInteractionRow = {
  interactionId: "DI-1",
  question: "Do we ingest a third-party catalog without a signed DPA?",
  outcomeType: "escalate",
  riskTier: "medium",
  principleConflict: false,
  rationale: "Constitutional alignment could not be established.",
  buildId: null,
  taskRunId: null,
  routeContext: "/coworker-business",
  domainClass: "risk-assessment",
  gateKey: "org-business",
  createdAt: new Date("2026-08-23"),
};

describe("aiDecisionToAttentionItem", () => {
  it("asks for judgment when nothing has been drafted", () => {
    const item = aiDecisionToAttentionItem(ROW);
    expect(item.triage.decideEffort).toBe("judgment");
    expect(item.actions[0]!.label).toBe("Review evidence");
    expect(item.context).toContain("Constitutional alignment");
  });

  it("asks for a review, and leads with the suggestion, once coworkers drafted one", () => {
    const item = aiDecisionToAttentionItem(ROW, {
      summary: "Decline the ingest until a data agreement exists",
    });
    expect(item.triage.decideEffort).toBe("review");
    expect(item.actions[0]!.label).toBe("Review the suggestion");
    expect(item.context).toBe("Decline the ingest until a data agreement exists");
  });

  it("keeps the honest residue reason either way", () => {
    expect(aiDecisionToAttentionItem(ROW, { summary: "x" }).triage.residueReason).toBe(
      aiDecisionToAttentionItem(ROW).triage.residueReason,
    );
  });
});
