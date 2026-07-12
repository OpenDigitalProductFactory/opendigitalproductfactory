import { describe, it, expect } from "vitest";
import {
  shouldRunPreSpecResearch,
  conductPreSpecResearch,
  formatResearchReportMarkdown,
  makeInferenceResearchDeps,
  type PreSpecResearchDeps,
  type ResearchReport,
} from "./pre-spec-research";

describe("shouldRunPreSpecResearch (pure trigger)", () => {
  it("runs for a medium+ feature", () => {
    expect(shouldRunPreSpecResearch({ workType: "feature", effortSize: "medium" })).toBe(true);
    expect(shouldRunPreSpecResearch({ workType: "feature", effortSize: "large" })).toBe(true);
  });
  it("skips a small feature", () => {
    expect(shouldRunPreSpecResearch({ workType: "feature", effortSize: "small" })).toBe(false);
  });
  it("runs a small feature when sensitivity is elevated/high", () => {
    expect(shouldRunPreSpecResearch({ workType: "feature", effortSize: "small", sensitivity: "elevated" })).toBe(true);
    expect(shouldRunPreSpecResearch({ workType: "feature", effortSize: "small", sensitivity: "high" })).toBe(true);
  });
  it("skips non-feature work regardless of size/sensitivity", () => {
    expect(shouldRunPreSpecResearch({ workType: "fix", effortSize: "large", sensitivity: "high" })).toBe(false);
    expect(shouldRunPreSpecResearch({ workType: "chore", effortSize: "xlarge" })).toBe(false);
    expect(shouldRunPreSpecResearch({ workType: "doc", effortSize: "large" })).toBe(false);
  });
  it("defaults missing workType to feature", () => {
    expect(shouldRunPreSpecResearch({ effortSize: "medium" })).toBe(true);
  });
});

function deps(over: Partial<PreSpecResearchDeps> = {}): PreSpecResearchDeps {
  return {
    planQueries: async () => ["q1", "q2"],
    search: async (q) => [{ title: `T-${q}`, url: `https://ex.com/${q}`, description: `snippet ${q}` }],
    fetchSource: async (u) => ({ title: `fetched ${u}`, textExcerpt: `body of ${u}` }),
    synthesize: async (_t, sources) => sources.map((s) => ({ claim: `finding from ${s.index}`, citations: [s.index] })),
    verifyFinding: async () => true,
    ...over,
  };
}

describe("conductPreSpecResearch", () => {
  it("produces a cited report with verified findings", async () => {
    const r = await conductPreSpecResearch("build a thing", deps());
    expect(r.sources.length).toBe(2); // one per query, deduped
    expect(r.findings.length).toBe(2);
    expect(r.findings.every((f) => f.verified)).toBe(true);
    expect(r.caveats.length).toBe(0);
  });

  it("dedups sources by URL across queries", async () => {
    const r = await conductPreSpecResearch("t", deps({
      planQueries: async () => ["a", "b"],
      search: async () => [{ title: "same", url: "https://same.com", description: "s" }],
    }));
    expect(r.sources.length).toBe(1);
  });

  it("moves unverifiable findings to caveats, never presenting them as fact", async () => {
    const r = await conductPreSpecResearch("t", deps({ verifyFinding: async () => false }));
    expect(r.findings.length).toBe(0);
    expect(r.caveats.length).toBeGreaterThan(0);
    expect(r.caveats[0]).toContain("Unverified:");
  });

  it("drops findings whose citations are out of range", async () => {
    const r = await conductPreSpecResearch("t", deps({
      synthesize: async () => [{ claim: "bad cite", citations: [99] }],
    }));
    expect(r.findings.length).toBe(0);
  });

  it("returns an honest empty report when no sources are reachable", async () => {
    const r = await conductPreSpecResearch("t", deps({ search: async () => [] }));
    expect(r.sources.length).toBe(0);
    expect(r.findings.length).toBe(0);
    expect(r.caveats[0]).toContain("No reachable external sources");
  });

  it("is robust to a search that throws (skips that query)", async () => {
    const r = await conductPreSpecResearch("t", deps({
      planQueries: async () => ["ok", "boom"],
      search: async (q) => { if (q === "boom") throw new Error("net"); return [{ title: "t", url: "https://ok.com", description: "d" }]; },
    }));
    expect(r.sources.length).toBe(1);
  });

  it("caps total sources", async () => {
    const r = await conductPreSpecResearch("t", deps({
      maxSources: 2,
      planQueries: async () => ["a", "b", "c", "d"],
      search: async (q) => [{ title: q, url: `https://${q}.com`, description: "d" }],
    }));
    expect(r.sources.length).toBe(2);
  });
});

describe("formatResearchReportMarkdown", () => {
  it("renders findings, caveats, and numbered sources", () => {
    const report: ResearchReport = {
      topic: "X",
      queries: ["q"],
      sources: [{ index: 1, title: "Src", url: "https://s.com", excerpt: "e" }],
      findings: [{ claim: "C", citations: [1], verified: true }],
      caveats: ["Unverified: Y"],
      summary: "sum",
    };
    const md = formatResearchReportMarkdown(report);
    expect(md).toContain("### Pre-spec research — X");
    expect(md).toContain("- C [1]");
    expect(md).toContain("Unverified: Y");
    expect(md).toContain("1. [Src](https://s.com)");
  });
});

describe("makeInferenceResearchDeps (prompt/JSON parsing)", () => {
  it("planQueries parses a JSON array from the llm", async () => {
    const d = makeInferenceResearchDeps({
      llm: async () => 'Here are queries: ["standards for X", "prior art Y"]',
      search: async () => [],
      fetchSource: async () => ({ title: null, textExcerpt: null }),
    });
    expect(await d.planQueries("topic")).toEqual(["standards for X", "prior art Y"]);
  });

  it("planQueries returns [] on unparseable llm output", async () => {
    const d = makeInferenceResearchDeps({ llm: async () => "no json", search: async () => [], fetchSource: async () => ({ title: null, textExcerpt: null }) });
    expect(await d.planQueries("t")).toEqual([]);
  });

  it("synthesize parses findings and filters empty claims", async () => {
    const d = makeInferenceResearchDeps({
      llm: async () => '{"findings":[{"claim":"a real finding","citations":[1]},{"claim":"","citations":[1]}]}',
      search: async () => [],
      fetchSource: async () => ({ title: null, textExcerpt: null }),
    });
    const out = await d.synthesize!("t", [{ index: 1, title: "s", url: "u", excerpt: "e" }]);
    expect(out).toEqual([{ claim: "a real finding", citations: [1] }]);
  });

  it("verifyFinding returns false when the finding has no in-range citation", async () => {
    const d = makeInferenceResearchDeps({ llm: async () => '{"grounded": true}', search: async () => [], fetchSource: async () => ({ title: null, textExcerpt: null }) });
    expect(await d.verifyFinding!({ claim: "c", citations: [] }, [{ index: 1, title: "s", url: "u", excerpt: "e" }])).toBe(false);
  });

  it("verifyFinding honors the llm grounded verdict", async () => {
    const src = [{ index: 1, title: "s", url: "u", excerpt: "e" }];
    const yes = makeInferenceResearchDeps({ llm: async () => '{"grounded": true}', search: async () => [], fetchSource: async () => ({ title: null, textExcerpt: null }) });
    const no = makeInferenceResearchDeps({ llm: async () => '{"grounded": false}', search: async () => [], fetchSource: async () => ({ title: null, textExcerpt: null }) });
    expect(await yes.verifyFinding!({ claim: "c", citations: [1] }, src)).toBe(true);
    expect(await no.verifyFinding!({ claim: "c", citations: [1] }, src)).toBe(false);
  });
});
