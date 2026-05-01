import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletenessStrip } from "./CompletenessStrip";
import type { PortfolioCompletenessScores } from "@/lib/portfolio/completeness";

function strip(overrides: Partial<PortfolioCompletenessScores> = {}): PortfolioCompletenessScores {
  return {
    requiredFieldsScore: 87,
    enrichmentScore: 64,
    openIssuesByType: { type_not_promotable: 5, incomplete_detail: 3 },
    productCount: 100,
    ...overrides,
  };
}

describe("CompletenessStrip", () => {
  it("renders three score figures + product count", () => {
    const html = renderToStaticMarkup(<CompletenessStrip scores={strip()} />);
    expect(html).toContain("87");
    expect(html).toContain("64");
    expect(html).toContain("8"); // 5 + 3 = 8 open issues
    expect(html).toContain("100 products tracked");
  });

  it("shows em-dash and tooltip when requiredFieldsScore is null", () => {
    const html = renderToStaticMarkup(
      <CompletenessStrip scores={strip({ requiredFieldsScore: null })} />,
    );
    // Should NOT show "null"; should show "—".
    expect(html).not.toMatch(/>null</);
    expect(html).toMatch(/>\s*—\s*</);
    expect(html).toContain("required fields configured");
  });

  it("shows em-dash and tooltip when enrichmentScore is null", () => {
    const html = renderToStaticMarkup(
      <CompletenessStrip scores={strip({ enrichmentScore: null })} />,
    );
    expect(html).toContain("Enrichment status not yet tracked");
  });

  it("shows zero when openIssuesByType is empty", () => {
    const html = renderToStaticMarkup(
      <CompletenessStrip scores={strip({ openIssuesByType: {} })} />,
    );
    expect(html).toContain(">0<");
  });

  it("breaks down open issues by type (top 3)", () => {
    const html = renderToStaticMarkup(
      <CompletenessStrip
        scores={strip({
          openIssuesByType: {
            type_not_promotable: 50,
            incomplete_detail: 25,
            no_taxonomy: 10,
            no_portfolio_root: 2,
            low_confidence_promotion: 1,
          },
        })}
      />,
    );
    // Top 3 by count: type_not_promotable (50), incomplete_detail (25), no_taxonomy (10).
    expect(html).toContain("50 type_not_promotable");
    expect(html).toContain("25 incomplete_detail");
    expect(html).toContain("10 no_taxonomy");
    // 2 more types beyond the top 3.
    expect(html).toMatch(/\+\s*2\s*more/);
  });

  it("uses only theme tokens — no hardcoded colors", () => {
    const html = renderToStaticMarkup(<CompletenessStrip scores={strip()} />);
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-|#[0-9a-fA-F]{3,6}/);
  });
});
