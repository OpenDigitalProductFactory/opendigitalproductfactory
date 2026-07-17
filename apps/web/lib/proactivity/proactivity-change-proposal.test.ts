import { describe, expect, it } from "vitest";

import {
  PROACTIVITY_CHANGE_ACTION,
  buildProactivityChangeProposalParameters,
  buildProactivitySelfTuneCandidate,
  parseProactivityChangeProposalParameters,
} from "./proactivity-change-proposal";

describe("proactivity change proposal parameters", () => {
  it("builds a bounded proposal payload with rationale and operator impacts", () => {
    const payload = buildProactivityChangeProposalParameters({
      agentId: "dispatcher",
      activityFamily: "field-dispatch-appointment",
      currentLevel: "balanced",
      proposedLevel: "assertive",
      scope: "activity-family",
      rationale: "Late customer appointments should be warned earlier.",
      evidenceRefs: [{ kind: "dispatch-event", id: "running-late" }],
    });

    expect(payload.actionType).toBe(PROACTIVITY_CHANGE_ACTION);
    expect(payload.parameters).toMatchObject({
      kind: "proactivity-change",
      currentLevel: "balanced",
      proposedLevel: "assertive",
      scope: "activity-family",
      spendImpact: "may increase monitoring and notification spend within existing authority",
      authorityImpact: "does not grant new tools, permissions, or approval bypasses",
    });
  });

  it("parses only valid closed-level proposals", () => {
    const valid = parseProactivityChangeProposalParameters({
      kind: "proactivity-change",
      agentId: "dispatcher",
      activityFamily: "field-dispatch-appointment",
      currentLevel: "balanced",
      proposedLevel: "assertive",
      scope: "activity-family",
      rationale: "Late customer appointments should be warned earlier.",
      evidenceRefs: [],
      spendImpact: "may increase monitoring and notification spend within existing authority",
      authorityImpact: "does not grant new tools, permissions, or approval bypasses",
    });

    expect(valid?.proposedLevel).toBe("assertive");
    expect(parseProactivityChangeProposalParameters({ kind: "proactivity-change", proposedLevel: "aggressive" })).toBeNull();
  });

  it("proposes a one-step self-tune after repeated unchanged approvals", () => {
    const candidate = buildProactivitySelfTuneCandidate({
      agentId: "bookkeeper",
      activityFamily: "finance-close",
      currentLevel: "balanced",
      approvedUnchangedCount: 8,
      operatingBoundary: "recurring bills under GBP 1,500",
      evidenceRefs: Array.from({ length: 8 }, (_, index) => ({
        kind: "bill-approval",
        id: `approval-${index + 1}`,
      })),
    });

    expect(candidate?.actionType).toBe(PROACTIVITY_CHANGE_ACTION);
    expect(candidate?.parameters).toMatchObject({
      currentLevel: "balanced",
      proposedLevel: "assertive",
      operatingBoundary: "recurring bills under GBP 1,500",
      approvedUnchangedCount: 8,
      hardFloors: ["money-out", "public"],
    });
    expect(candidate?.parameters.rationale).toContain("last 8");
    expect(candidate?.parameters.authorityImpact).toContain("does not grant new tools");
  });

  it("does not self-tune before the evidence threshold or above assertive", () => {
    expect(
      buildProactivitySelfTuneCandidate({
        agentId: "bookkeeper",
        activityFamily: "finance-close",
        currentLevel: "balanced",
        approvedUnchangedCount: 4,
        operatingBoundary: "recurring bills under GBP 1,500",
        evidenceRefs: [],
      }),
    ).toBeNull();
    expect(
      buildProactivitySelfTuneCandidate({
        agentId: "bookkeeper",
        activityFamily: "finance-close",
        currentLevel: "assertive",
        approvedUnchangedCount: 12,
        operatingBoundary: "recurring bills under GBP 1,500",
        evidenceRefs: [],
      }),
    ).toBeNull();
  });
});
