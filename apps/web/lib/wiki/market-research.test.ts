import { describe, expect, it, vi } from "vitest";

import {
  runMarketResearch,
  buildResearchPrompt,
  type MarketResearchDeps,
} from "./market-research";
import type { NormalizedSearchResult } from "@/lib/public-web-tools";

const RESULTS: NormalizedSearchResult[] = [
  { title: "HVAC market trends 2026", url: "https://ex.com/a", snippet: "Residential HVAC demand is up 6%." },
  { title: "Local HVAC competitors", url: "https://ex.com/b", snippet: "Three national chains plus independents." },
];

function deps(over: Partial<MarketResearchDeps> = {}): MarketResearchDeps {
  return {
    search: vi.fn(async () => RESULTS),
    infer: vi.fn(async () => "Residential demand is rising and the field is split between chains and independents."),
    ...over,
  };
}

describe("buildResearchPrompt", () => {
  it("includes the query, the snippets, and an anti-fabrication instruction", () => {
    const { systemPrompt, userPrompt } = buildResearchPrompt("HVAC competitive landscape", RESULTS);
    expect(systemPrompt.toLowerCase()).toMatch(/do not (fabricate|invent)|only.*provided/);
    expect(userPrompt).toContain("HVAC competitive landscape");
    expect(userPrompt).toContain("Residential HVAC demand is up 6%.");
    expect(userPrompt).toContain("https://ex.com/a");
  });

  it("asks for changed-since output when a reviewed baseline exists", () => {
    const { systemPrompt, userPrompt } = buildResearchPrompt(
      "HVAC competitive landscape",
      RESULTS,
      {
        text: "Previously, two national chains were active.",
        reviewedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    );
    expect(systemPrompt).toMatch(/changed.*since/);
    expect(userPrompt).toContain("Last reviewed baseline");
    expect(userPrompt).toContain("Previously, two national chains were active.");
  });
});

describe("runMarketResearch", () => {
  it("synthesises cited prose from web results", async () => {
    const d = deps();
    const res = await runMarketResearch({ organizationId: "org_1", query: "HVAC competitive landscape" }, d);

    expect(res.empty).toBe(false);
    expect(res.emptyReason).toBeNull();
    expect(res.text).toContain("Residential demand is rising");
    // Sources section cites the backing URLs for provenance.
    expect(res.text).toContain("## Sources");
    expect(res.text).toContain("https://ex.com/a");
    expect(res.sources).toHaveLength(2);
    expect(res.sources[0]).toMatchObject({
      url: "https://ex.com/a",
      retrievedAt: expect.any(Date),
    });
    expect(res.confidence).toBe("medium");
    expect(res.comparison).toEqual({ kind: "first-run", baselineReviewedAt: null });
  });

  it("labels a reviewed-baseline run as changed-since", async () => {
    const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
    const res = await runMarketResearch(
      {
        organizationId: "org_1",
        query: "x",
        reviewedBaseline: { text: "Earlier findings", reviewedAt },
      },
      deps(),
    );
    expect(res.text).toContain("## Changed since the last reviewed research");
    expect(res.comparison).toEqual({ kind: "changed-since", baselineReviewedAt: reviewedAt });
  });

  it("returns empty (and skips inference) when search yields nothing", async () => {
    const infer = vi.fn(async () => "should not be called");
    const res = await runMarketResearch(
      { organizationId: "org_1", query: "x" },
      { search: vi.fn(async () => []), infer },
    );
    expect(res.empty).toBe(true);
    expect(res.emptyReason).toBe("no-results");
    expect(res.sources).toHaveLength(0);
    expect(infer).not.toHaveBeenCalled();
  });

  it("is fail-open when search throws", async () => {
    const res = await runMarketResearch(
      { organizationId: "org_1", query: "x" },
      { search: vi.fn(async () => { throw new Error("brave down"); }), infer: vi.fn(async () => "x") },
    );
    expect(res.empty).toBe(true);
    expect(res.emptyReason).toBe("provider-unavailable");
  });

  it("treats blank synthesis as empty (no fabricated findings)", async () => {
    const res = await runMarketResearch(
      { organizationId: "org_1", query: "x" },
      { search: vi.fn(async () => RESULTS), infer: vi.fn(async () => "   ") },
    );
    expect(res.empty).toBe(true);
    expect(res.emptyReason).toBe("synthesis-empty");
  });

  it("caps the number of sources", async () => {
    const many: NormalizedSearchResult[] = Array.from({ length: 20 }, (_, i) => ({
      title: `r${i}`, url: `https://ex.com/${i}`, snippet: `s${i}`,
    }));
    const res = await runMarketResearch(
      { organizationId: "org_1", query: "x", maxSources: 3 },
      { search: vi.fn(async () => many), infer: vi.fn(async () => "synthesis") },
    );
    expect(res.sources).toHaveLength(3);
  });
});
