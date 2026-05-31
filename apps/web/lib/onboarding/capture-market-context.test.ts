import { describe, expect, it, vi } from "vitest";

import {
  captureMarketContext,
  buildMarketNarrative,
  type MarketContextEnricher,
} from "./capture-market-context";

const ORG = "org_123";

describe("buildMarketNarrative", () => {
  it("includes a labelled section for each non-empty answer", () => {
    const { text, sections } = buildMarketNarrative({
      competitiveLandscape: "Two national chains plus local independents.",
      marketSize: "~12k homeowners in the tri-county area.",
      differentiators: "Same-day service and transparent pricing.",
      positioning: "Premium-but-fair local specialist.",
    });
    expect(sections).toEqual([
      "Competitive landscape",
      "Market size",
      "What sets us apart",
      "Positioning",
    ]);
    expect(text).toContain("Two national chains");
    expect(text).toContain("tri-county");
  });

  it("omits blank answers and returns empty sections when nothing is provided", () => {
    expect(buildMarketNarrative({}).sections).toEqual([]);
    expect(buildMarketNarrative({ competitiveLandscape: "   " }).sections).toEqual([]);
  });
});

describe("captureMarketContext", () => {
  it("composes a narrative and invokes the enrichment seam (first-party)", async () => {
    const enrich = vi.fn<MarketContextEnricher>(async () => {});
    const res = await captureMarketContext(
      { organizationId: ORG, answers: { competitiveLandscape: "Local independents.", marketSize: "12k homes." } },
      { enrich },
    );

    expect(res.captured).toBe(true);
    expect(res.enrichmentQueued).toBe(true);
    expect(res.sections).toContain("Competitive landscape");
    expect(enrich).toHaveBeenCalledTimes(1);
    const arg = enrich.mock.calls[0][0];
    expect(arg.organizationId).toBe(ORG);
    expect(arg.text).toContain("Local independents.");
    expect(arg.title.length).toBeGreaterThan(0);
  });

  it("is a no-op when no answers are provided", async () => {
    const enrich = vi.fn<MarketContextEnricher>(async () => {});
    const res = await captureMarketContext({ organizationId: ORG, answers: {} }, { enrich });
    expect(res.captured).toBe(false);
    expect(res.enrichmentQueued).toBe(false);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("captures without enriching when no seam is wired", async () => {
    const res = await captureMarketContext(
      { organizationId: ORG, answers: { marketSize: "12k homes." } },
      {},
    );
    expect(res.captured).toBe(true);
    expect(res.enrichmentQueued).toBe(false);
  });
});
