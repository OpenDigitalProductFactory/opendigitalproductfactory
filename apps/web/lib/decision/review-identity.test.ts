import { describe, expect, it } from "vitest";

import {
  clusterDecisionReviewRows,
  decisionReviewIdentity,
  normalizeDecisionReviewQuestion,
} from "./review-identity";

describe("decision review identity", () => {
  it("normalizes casing and whitespace without guessing at semantic similarity", () => {
    expect(normalizeDecisionReviewQuestion("  Sign a 3-year   contract? ")).toBe(
      "sign a 3-year contract?",
    );
    expect(
      decisionReviewIdentity({
        profileId: "ORG-1",
        domainClass: "Risk-Assessment",
        question: " Sign a 3-year contract? ",
      }),
    ).toBe("org-1|risk-assessment|sign a 3-year contract?");
  });

  it("projects repeated ledger rows as one newest-first work item with a count", () => {
    const rows = [
      { id: "new", profileId: "org-1", domainClass: "risk", question: "Sign?" },
      { id: "old", profileId: "org-1", domainClass: "risk", question: "  SIGN?  " },
      { id: "different", profileId: "org-1", domainClass: "risk", question: "Renew?" },
    ];

    expect(clusterDecisionReviewRows(rows)).toEqual([
      { ...rows[0], occurrenceCount: 2 },
      { ...rows[2], occurrenceCount: 1 },
    ]);
  });

  it("does not merge the same wording across profiles or decision domains", () => {
    const rows = [
      { id: "a", profileId: "org-1", domainClass: "risk", question: "Proceed?" },
      { id: "b", profileId: "org-2", domainClass: "risk", question: "Proceed?" },
      { id: "c", profileId: "org-1", domainClass: "plan", question: "Proceed?" },
    ];

    expect(clusterDecisionReviewRows(rows)).toHaveLength(3);
  });
});
