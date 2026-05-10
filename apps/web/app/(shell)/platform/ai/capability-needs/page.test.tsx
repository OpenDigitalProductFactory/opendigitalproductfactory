import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: any; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/coworker-self-assessment/review-service", () => ({
  getCoworkerCapabilityNeedReview: vi.fn(),
  parseCoworkerCapabilityNeedReviewFilters: vi.fn((input) => ({
    status: input.status,
    severity: input.severity,
    kind: input.kind,
    agentId: input.agentId,
  })),
}));

vi.mock("@/lib/actions/coworker-capability-needs", () => ({
  linkCoworkerCapabilityNeedToBacklogAction: vi.fn(),
  resolveCoworkerCapabilityNeedAction: vi.fn(),
}));

import { getCoworkerCapabilityNeedReview } from "@/lib/coworker-self-assessment/review-service";

describe("CoworkerCapabilityNeedsPage", () => {
  it("renders a read-only review queue with coworker attribution and evidence", async () => {
    vi.mocked(getCoworkerCapabilityNeedReview).mockResolvedValue({
      summary: {
        total: 1,
        byStatus: { submitted: 1 },
        bySeverity: { blocker: 1 },
        byKind: { tool: 1 },
      },
      filterOptions: {
        statuses: ["submitted"],
        severities: ["blocker"],
        kinds: ["tool"],
      },
      needs: [
        {
          needId: "CWN-001",
          assessmentId: "CWSA-001",
          agentId: "marketing-strategist",
          coworkerName: "Marketing Strategist",
          coworkerSlug: "marketing-strategist",
          coworkerTier: 2,
          valueStream: "revenue",
          kind: "tool",
          severity: "blocker",
          status: "submitted",
          need: "Publish proof assets from approved offers.",
          blocks: "Cannot create campaign assets without tool access.",
          evidencePreview: "route: /customer/marketing",
          readinessPreview: "missing: marketing_write",
          linkedBacklogItemId: null,
          linkedBacklogItemTitle: null,
          linkedBacklogItemStatus: null,
          duplicateOfId: null,
          duplicateOfNeed: null,
          duplicateCount: 0,
          reviewerNote: null,
          assessmentVerdict: "blocked",
          assessmentConfidence: "high",
          missionSummary: "Drive customer acquisition.",
          capabilitySummary: "Can advise, cannot publish.",
          routeContext: "customer-marketing",
          trigger: "tool-call",
          createdAtLabel: "May 10, 2026",
          updatedAtLabel: "May 10, 2026",
        },
      ],
    });

    const { default: CoworkerCapabilityNeedsPage } = await import("./page");
    const html = renderToStaticMarkup(
      await CoworkerCapabilityNeedsPage({
        searchParams: Promise.resolve({ status: "submitted", severity: "blocker" }),
      }),
    );

    expect(getCoworkerCapabilityNeedReview).toHaveBeenCalledWith({
      status: "submitted",
      severity: "blocker",
      kind: undefined,
      agentId: undefined,
    });
    expect(html).toContain("Capability Needs");
    expect(html).toContain("Marketing Strategist");
    expect(html).toContain("Publish proof assets from approved offers.");
    expect(html).toContain("Cannot create campaign assets without tool access.");
    expect(html).toContain("route: /customer/marketing");
    expect(html).toContain("missing: marketing_write");
    expect(html).toContain("Review queue");
    expect(html).toContain("Accept");
    expect(html).toContain("Defer");
    expect(html).toContain("Discard");
    expect(html).toContain("Mark duplicate");
    expect(html).toContain("Link backlog item");
  });
});
