import { describe, expect, it, vi } from "vitest";

import { getCoworkerCapabilityNeedReview } from "./review-service";

describe("getCoworkerCapabilityNeedReview", () => {
  it("returns reviewer-shaped needs, filters, and summary counts", async () => {
    const db = {
      listReviewNeeds: vi.fn().mockResolvedValue([
        {
          needId: "CWN-001",
          assessmentId: "CWSA-001",
          agentId: "marketing-strategist",
          kind: "tool",
          severity: "blocker",
          status: "submitted",
          need: "Publish proof assets from approved offers.",
          blocks: "Cannot create campaign assets without tool access.",
          evidenceJson: { route: "/customer/marketing" },
          readinessJson: { missing: ["marketing_write"] },
          linkedBacklogItemId: null,
          duplicateOfId: null,
          reviewerNote: null,
          createdAt: new Date("2026-05-10T10:00:00Z"),
          updatedAt: new Date("2026-05-10T10:05:00Z"),
          agent: {
            name: "Marketing Strategist",
            slugId: "marketing-strategist",
            tier: 2,
            valueStream: "revenue",
          },
          assessment: {
            verdict: "blocked",
            confidence: "high",
            missionSummary: "Drive customer acquisition.",
            capabilitySummary: "Can advise, cannot publish.",
            routeContext: "customer-marketing",
            trigger: "tool-call",
            createdAt: new Date("2026-05-10T09:55:00Z"),
          },
          linkedBacklogItem: null,
          duplicateOf: null,
          duplicates: [{ needId: "CWN-002" }],
        },
      ]),
    };

    const review = await getCoworkerCapabilityNeedReview(
      { status: "submitted", severity: "blocker" },
      { db },
    );

    expect(db.listReviewNeeds).toHaveBeenCalledWith({
      status: "submitted",
      severity: "blocker",
    });
    expect(review.summary.total).toBe(1);
    expect(review.summary.byStatus).toEqual({ submitted: 1 });
    expect(review.summary.bySeverity).toEqual({ blocker: 1 });
    expect(review.needs[0]).toMatchObject({
      needId: "CWN-001",
      coworkerName: "Marketing Strategist",
      coworkerSlug: "marketing-strategist",
      duplicateCount: 1,
      assessmentVerdict: "blocked",
      assessmentConfidence: "high",
    });
    expect(review.filterOptions.statuses).toContain("submitted");
    expect(review.filterOptions.severities).toContain("blocker");
    expect(review.filterOptions.kinds).toContain("tool");
  });
});
