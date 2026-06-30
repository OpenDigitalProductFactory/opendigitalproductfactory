import { describe, expect, it } from "vitest";

import {
  PROACTIVITY_CHANGE_ACTION,
  buildProactivityChangeProposalParameters,
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
});
