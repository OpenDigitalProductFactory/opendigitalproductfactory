import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialBacklinksPanel } from "./MaterialBacklinksPanel";
import type { MaterialBacklinksResult } from "@/lib/decision-perspective/material-backlinks";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a className={className} href={href}>{children}</a>
  ),
}));

function result(overrides: Partial<MaterialBacklinksResult> = {}): MaterialBacklinksResult {
  return {
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
      inLinks: [
        {
          id: "WP-2",
          slug: "agent-trace-hiding",
          title: "Agent trace hiding",
          pageKind: "stance",
          status: "published",
          isKernel: true,
        },
      ],
      outLinks: [
        {
          id: "WP-3",
          slug: "single-source-of-truth",
          title: "Single source of truth",
          pageKind: "heuristic",
          status: "published",
          isKernel: true,
        },
      ],
      stancesAndHeuristics: [
        {
          id: "WP-2",
          slug: "agent-trace-hiding",
          title: "Agent trace hiding",
          pageKind: "stance",
          status: "published",
          isKernel: true,
        },
      ],
    },
    sources: [
      {
        id: "RS-1",
        sourceKey: "obsidian-help",
        title: "Obsidian backlinks",
        sourceType: "article",
        url: "https://example.test/backlinks",
        abstract: null,
      },
    ],
    priorDecisions: [
      {
        interactionId: "DI-1",
        profileId: "profile-mark",
        question: "How should decisions show material?",
        outcomeType: "recommend",
        createdAt: "2026-05-31T12:00:00.000Z",
      },
    ],
    openWork: [],
    missingReason: "none",
    ...overrides,
  };
}

describe("MaterialBacklinksPanel", () => {
  it("renders linked stance, heuristic, citation, and prior-decision groups", () => {
    const html = renderToStaticMarkup(<MaterialBacklinksPanel result={result()} />);

    expect(html).toContain("Material Backlinks");
    expect(html).toContain("Architecture over shortcuts");
    expect(html).toContain("Agent trace hiding");
    expect(html).toContain("Single source of truth");
    expect(html).toContain("Obsidian backlinks");
    expect(html).toContain('href="https://example.test/backlinks"');
    expect(html).toContain("How should decisions show material?");
    expect(html).toContain('href="/platform/ai/decisions/DI-1"');
  });

  it("renders a stable empty panel when no governed backlinks exist", () => {
    const html = renderToStaticMarkup(
      <MaterialBacklinksPanel result={result({ missingReason: "wiki-page-not-found" })} />,
    );

    expect(html).toContain("Material Backlinks");
    expect(html).toContain("No linked material graph is available");
    expect(html).not.toContain("Architecture over shortcuts");
  });

  it("does not present draft candidate material as active doctrine", () => {
    const html = renderToStaticMarkup(
      <MaterialBacklinksPanel
        result={result({
          material: {
            ...result().material,
            reviewStatus: "draft",
            promotionState: "candidate",
          },
        })}
      />,
    );

    expect(html).toContain("waiting for review");
    expect(html).not.toContain("Referenced by");
    expect(html).not.toContain("Obsidian backlinks");
  });
});
