import { describe, expect, it } from "vitest";

import { projectActionProposalPresentation } from "./action-proposal-presentation";

describe("projectActionProposalPresentation", () => {
  it("renders field-dispatch notification proposals with why-now context", () => {
    const presentation = projectActionProposalPresentation({
      proposalId: "AP-DISPATCH",
      actionType: "field_dispatch_customer_notification",
      parameters: {
        kind: "field-dispatch-customer-notification",
        jobId: "JOB-1",
        recommendedAction: "Send running-late customer update",
        whyNow: "Customer appointment timing is operationally load-bearing.",
        intent: {
          event: "running-late",
          jobId: "JOB-1",
          urgency: "urgent",
          title: "Running a little behind",
          body: "We're running a bit behind.",
        },
        proactivity: {
          resolvedLevel: "assertive",
          actionBoundary: "propose",
        },
      },
    });

    expect(presentation.title).toBe("Send running-late customer update");
    expect(presentation.shortLabel).toBe("Customer update");
    expect(presentation.summary).toBe("Why now: Customer appointment timing is operationally load-bearing.");
    expect(presentation.details).toContainEqual({ label: "Proactivity", value: "Assertive" });
    expect(presentation.details).toContainEqual({ label: "Approval", value: "Asks first" });
    expect(presentation.summary).not.toMatch(/AP-|queue|diagnostic/i);
  });

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
