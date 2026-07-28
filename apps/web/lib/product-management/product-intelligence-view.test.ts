import { describe, expect, it } from "vitest";
import {
  buildProductIntelligenceView,
  type ProductIntelligenceViewInput,
} from "./product-intelligence-view";

const now = new Date("2026-07-28T20:00:00.000Z");

function input(
  overrides: Partial<ProductIntelligenceViewInput> = {},
): ProductIntelligenceViewInput {
  return {
    requestedAt: now,
    audience: "guided",
    product: {
      id: "product-1",
      name: "Hair appointments",
      productLineId: "line-1",
    },
    intelligence: [],
    watches: [],
    ...overrides,
  };
}

describe("buildProductIntelligenceView", () => {
  it("produces one useful first-run action instead of a zero dashboard", () => {
    const view = buildProductIntelligenceView(input());
    expect(view.firstRun).toBe(true);
    expect(view.primaryAction).toEqual({
      kind: "propose-research",
      label: "Propose research",
    });
    expect(view.emptyState).toMatch(/No reviewed product research yet/i);
  });

  it("separates pending decisions, reviewed findings, battlecards, and stale evidence", () => {
    const old = new Date("2026-05-01T00:00:00.000Z");
    const view = buildProductIntelligenceView(
      input({
        intelligence: [
          {
            id: "pending",
            sourceKind: "research-proposal",
            asOf: now,
            title: "Competitive landscape",
            scope: "business-product",
            businessProductId: "product-1",
            digitalProductId: null,
            status: "pending",
          },
          {
            id: "reviewed",
            sourceKind: "wiki-page",
            asOf: now,
            title: "Customer choice factors",
            relatedProposalId: "reviewed-proposal",
            scope: "digital-product",
            digitalProductId: "digital-1",
            status: "published",
          },
          {
            id: "battlecard",
            sourceKind: "marketing-battlecard",
            asOf: now,
            title: "Acme Salon",
            scope: "product-line",
            productLineId: "line-1",
            digitalProductId: null,
            status: "active",
          },
          {
            id: "stale",
            sourceKind: "research-proposal",
            asOf: old,
            title: "Old market scan",
            scope: "organization",
            digitalProductId: null,
            status: "executed",
          },
          {
            id: "failed",
            sourceKind: "research-proposal",
            asOf: now,
            title: "Unavailable provider",
            scope: "business-product",
            businessProductId: "product-1",
            digitalProductId: null,
            status: "failed",
          },
          {
            id: "provider-unavailable",
            sourceKind: "research-proposal",
            asOf: now,
            title: "Provider check",
            detail: "Research provider unavailable.",
            scope: "business-product",
            businessProductId: "product-1",
            digitalProductId: null,
            status: "executed",
            emptyReason: "provider-unavailable",
          },
        ],
      }),
    );

    expect(view.pending.map((item) => item.id)).toEqual(["pending"]);
    expect(view.reviewed.map((item) => item.id)).toEqual(["reviewed"]);
    expect(view.battlecards.map((item) => item.id)).toEqual(["battlecard"]);
    expect(view.stale.map((item) => item.id)).toEqual(["stale"]);
    expect(view.failed.map((item) => item.id)).toEqual(["failed"]);
    expect(view.noFindings.map((item) => item.id)).toEqual([
      "provider-unavailable",
    ]);
    expect(view.pending[0]?.scopeLabel).toBe("This product");
    expect(view.battlecards[0]?.scopeLabel).toBe("Product line");
  });

  it("removes an executed proposal from the draft queue once its Wiki page is reviewed", () => {
    const view = buildProductIntelligenceView(
      input({
        intelligence: [
          {
            id: "proposal-1",
            sourceKind: "research-proposal",
            asOf: now,
            title: "Customer choice",
            scope: "business-product",
            businessProductId: "product-1",
            digitalProductId: null,
            status: "executed",
          },
          {
            id: "wiki-1",
            sourceKind: "wiki-page",
            asOf: now,
            title: "Reviewed customer choice",
            relatedProposalId: "proposal-1",
            scope: "business-product",
            businessProductId: "product-1",
            digitalProductId: null,
            status: "published",
          },
        ],
      }),
    );

    expect(view.drafts).toEqual([]);
    expect(view.reviewed.map((item) => item.id)).toEqual(["wiki-1"]);
  });

  it("shows more evidence detail to professional users without changing the model", () => {
    expect(
      buildProductIntelligenceView(input({ audience: "professional" }))
        .evidencePreviewCount,
    ).toBeGreaterThan(
      buildProductIntelligenceView(input({ audience: "guided" }))
        .evidencePreviewCount,
    );
  });
});
