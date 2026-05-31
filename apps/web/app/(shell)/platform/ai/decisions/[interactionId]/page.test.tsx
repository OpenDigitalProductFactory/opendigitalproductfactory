import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    decisionInteraction: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a className={className} href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@/lib/decision-perspective/material-backlinks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/decision-perspective/material-backlinks")>(
    "@/lib/decision-perspective/material-backlinks",
  );
  return {
    ...actual,
    getMaterialBacklinks: vi.fn(),
  };
});

import { prisma } from "@dpf/db";
import { getMaterialBacklinks } from "@/lib/decision-perspective/material-backlinks";

const emptyBacklinks = {
  material: {
    materialId: "PM-1",
    profileId: "profile-mark",
    sourceType: "principle",
    summary: "Architecture over shortcuts",
    domainClass: "architecture-tradeoff",
    direction: "support",
    reviewStatus: "approved",
    promotionState: "promoted",
    wikiPageId: "WP-1",
    wikiSlug: "architecture-over-shortcuts",
  },
  wikiNeighborhood: {
    page: {
      id: "WP-1",
      slug: "architecture-over-shortcuts",
      title: "Architecture over shortcuts",
      pageKind: "principle",
      status: "published",
      isKernel: true,
    },
    inLinks: [],
    outLinks: [],
    stancesAndHeuristics: [],
  },
  sources: [],
  priorDecisions: [],
  openWork: [],
  missingReason: "none",
};

describe("DecisionInteractionPage", () => {
  it("renders a WWMD decision canvas from a persisted decision interaction", async () => {
    vi.mocked(prisma.decisionInteraction.findUnique).mockResolvedValue({
      id: "row-1",
      interactionId: "DI-1",
      profileId: "profile-mark",
      profileVersionId: "version-1",
      fallbackProfileId: null,
      buildId: "FB-1",
      taskRunId: null,
      deliberationRunId: null,
      triggeredByUserId: null,
      routeContext: "/build",
      phaseFrom: "plan",
      phaseTo: "build",
      domainClass: "architecture-tradeoff",
      question: "How should we explain decisions?",
      options: ["Projection service", "New decision engine"],
      evidenceBundle: {},
      sources: [
        {
          materialId: "PM-1",
          sourceType: "principle",
          summary: "Architecture over shortcuts",
          effectiveWeight: 0.8,
        },
      ],
      rationale: "principle_decide recommends Projection service.",
      riskTier: "medium",
      confidenceBefore: 0.4,
      confidenceAfter: 0.82,
      outcomeType: "recommend",
      principleConflict: false,
      outcomePayload: {
        confidenceScore: 0.82,
        materialCount: 1,
      },
      humanOutcome: null,
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      updatedAt: new Date("2026-05-31T12:00:00.000Z"),
      profile: {
        profileId: "profile-mark",
        name: "WWMD Platform",
        kind: "platform",
      },
    } as never);
    vi.mocked(getMaterialBacklinks).mockResolvedValue(emptyBacklinks as never);

    const { default: DecisionInteractionPage } = await import("./page");
    const html = renderToStaticMarkup(
      await DecisionInteractionPage({
        params: Promise.resolve({ interactionId: "DI-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("WWMD");
    expect(html).toContain("WWMD Platform");
    expect(html).toContain("How should we explain decisions?");
    expect(html).toContain("Recommended");
    expect(html).toContain("Architecture over shortcuts");
    expect(html).toContain("Material Backlinks");
    expect(html).not.toContain("principle_decide");
    expect(html).not.toContain("mcp");
  });

  it("uses owner-review wording for WWWD deferred decisions", async () => {
    vi.mocked(prisma.decisionInteraction.findUnique).mockResolvedValue({
      id: "row-2",
      interactionId: "DI-2",
      profileId: "profile-org",
      profileVersionId: "version-2",
      fallbackProfileId: null,
      buildId: null,
      taskRunId: null,
      deliberationRunId: null,
      triggeredByUserId: null,
      routeContext: "/storefront",
      phaseFrom: null,
      phaseTo: null,
      domainClass: "risk-assessment",
      question: "Should we change the service guarantee?",
      options: ["Change it", "Keep it"],
      evidenceBundle: {},
      sources: [],
      rationale: "No approved organization policy applies.",
      riskTier: "high",
      confidenceBefore: 0.2,
      confidenceAfter: 0.2,
      outcomeType: "defer",
      principleConflict: false,
      outcomePayload: {
        confidenceScore: 0.2,
        coverageGap: true,
      },
      humanOutcome: null,
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      updatedAt: new Date("2026-05-31T12:00:00.000Z"),
      profile: {
        profileId: "profile-org",
        name: "WWWD Organization",
        kind: "organization",
      },
    } as never);
    vi.mocked(getMaterialBacklinks).mockResolvedValue({
      ...emptyBacklinks,
      missingReason: "no-target",
    } as never);

    const { default: DecisionInteractionPage } = await import("./page");
    const html = renderToStaticMarkup(
      await DecisionInteractionPage({
        params: Promise.resolve({ interactionId: "DI-2" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("WWWD");
    expect(html).toContain("Send to owner review");
    expect(html).not.toContain("Send to founder review");
  });
});
