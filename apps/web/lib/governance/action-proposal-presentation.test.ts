import { describe, expect, it } from "vitest";

import { projectActionProposalPresentation } from "./action-proposal-presentation";

describe("projectActionProposalPresentation", () => {
  it("renders proactivity change proposals without implying broader authority", () => {
    const presentation = projectActionProposalPresentation({
      proposalId: "AP-PROACTIVE",
      actionType: "propose_proactivity_change",
      parameters: {
        kind: "proactivity-change",
        currentLevel: "balanced",
        proposedLevel: "assertive",
        scope: "activity-family",
        activityFamily: "field-dispatch-appointment",
        rationale: "Late customer appointments should be warned earlier.",
        evidenceRefs: [],
        spendImpact: "may increase monitoring and notification spend within existing authority",
        authorityImpact: "does not grant new tools, permissions, or approval bypasses",
      },
    });

    expect(presentation.title).toBe("Change proactivity to Assertive");
    expect(presentation.shortLabel).toBe("Proactivity change");
    expect(presentation.summary).toBe("Why now: Late customer appointments should be warned earlier.");
    expect(presentation.details).toContainEqual({ label: "Authority", value: "does not grant new tools, permissions, or approval bypasses" });
    expect(presentation.summary).not.toMatch(/AP-|queue|diagnostic/i);
  });
});
