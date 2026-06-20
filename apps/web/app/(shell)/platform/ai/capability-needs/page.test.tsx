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

// The page backfills orphans on render — stub it so the test never touches prisma.
vi.mock("@/lib/coworker-self-assessment/capability-backlog-reconcile", () => ({
  reconcileCapabilityNeedBacklog: vi.fn(async () => ({ filed: 0, itemIds: [] })),
}));

import { getCoworkerCapabilityNeedReview } from "@/lib/coworker-self-assessment/review-service";
import { reconcileCapabilityNeedBacklog } from "@/lib/coworker-self-assessment/capability-backlog-reconcile";

describe("CoworkerCapabilityNeedsPage", () => {
  it("renders a read-only evidence view showing the linked backlog status, not a parallel lifecycle", async () => {
    vi.mocked(getCoworkerCapabilityNeedReview).mockResolvedValue({
      summary: {
        total: 1,
        byStatus: { "backlog-filed": 1 },
        bySeverity: { blocker: 1 },
        byKind: { tool: 1 },
      },
      filterOptions: {
        statuses: ["backlog-filed"],
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
          status: "backlog-filed",
          need: "Publish proof assets from approved offers.",
          blocks: "Cannot create campaign assets without tool access.",
          evidencePreview: "route: /customer/marketing",
          readinessPreview: "missing: marketing_write",
          linkedBacklogItemId: "BI-CAP-12AB34CD",
          linkedBacklogItemTitle: "Marketing publish tool",
          linkedBacklogItemStatus: "in-progress",
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
        searchParams: Promise.resolve({ severity: "blocker" }),
      }),
    );

    // Backfill ran before render.
    expect(reconcileCapabilityNeedBacklog).toHaveBeenCalled();

    // Evidence is shown.
    expect(html).toContain("Capability Needs");
    expect(html).toContain("Marketing Strategist");
    expect(html).toContain("Publish proof assets from approved offers.");
    expect(html).toContain("route: /customer/marketing");
    expect(html).toContain("Evidence view");

    // The canonical backlog status + link are shown (one lifecycle).
    expect(html).toContain("in-progress");
    expect(html).toContain("View backlog item BI-CAP-12AB34CD");

    // The parallel improvement-style lifecycle is GONE.
    expect(html).not.toContain("Review actions");
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain(">Defer<");
    expect(html).not.toContain(">Discard<");
    expect(html).not.toContain("Mark duplicate");
    expect(html).not.toContain("Link backlog item");
  });
});
