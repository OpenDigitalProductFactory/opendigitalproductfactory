import { beforeEach, describe, expect, it, vi } from "vitest";

const specPlan = vi.hoisted(() => ({ searchSpecsAndPlans: vi.fn(), specPlanCorpusCaveat: vi.fn(() => null) }));
vi.mock("@/lib/backlog/spec-plan-search", () => specPlan);

const codeGraphAccess = vi.hoisted(() => ({ getCodeGraphFreshness: vi.fn() }));
vi.mock("@/lib/build/code-graph-access", () => codeGraphAccess);

const trustVector = vi.hoisted(() => ({ buildTrustMessage: vi.fn() }));
vi.mock("@/lib/trust-vector", () => trustVector);

const graphQueries = vi.hoisted(() => ({
  searchCodeGraph: vi.fn(),
  traceCodeSurface: vi.fn(),
  findRelatedTests: vi.fn(),
}));
vi.mock("@/lib/build/code-graph/graph-queries", () => graphQueries);

const canonical = vi.hoisted(() => ({ matchCanonicalPrimitives: vi.fn() }));
vi.mock("@/lib/canonical-primitives", () => canonical);

import { codeIntelligencePack } from "./code-intelligence-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "search_specs_and_plans",
  "get_code_graph_freshness",
  "search_code_graph",
  "trace_code_surface",
  "find_related_tests",
  "analyze_reusability",
];

const EXPECTED_GRANTS: Record<string, string[]> = {
  search_specs_and_plans: ["spec_plan_read", "backlog_read"],
  get_code_graph_freshness: ["code_graph_read"],
  search_code_graph: ["code_graph_read"],
  trace_code_surface: ["code_graph_read"],
  find_related_tests: ["code_graph_read"],
  analyze_reusability: ["backlog_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
  canonical.matchCanonicalPrimitives.mockReturnValue([]);
});

describe("code-intelligence pack — registration", () => {
  it("exposes exactly the six code-intelligence tools", () => {
    expect(codeIntelligencePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(codeIntelligencePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(codeIntelligencePack.packId).toBe("code-intelligence");
  });

  it("descriptions are provenance-free (no BI/Phase/path leakage)", () => {
    for (const d of codeIntelligencePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("preserves requiredCapability, sideEffect, and buildPhases metadata verbatim", () => {
    const byName = Object.fromEntries(codeIntelligencePack.definitions.map((d) => [d.name, d]));
    for (const t of EXPECTED_TOOLS) {
      expect(byName[t].executionMode, t).toBe("immediate");
      expect(byName[t].sideEffect, t).toBe(false);
    }
    expect(byName.search_specs_and_plans.requiredCapability).toBe("view_operations");
    expect(byName.search_specs_and_plans.buildPhases).toBeUndefined();
    expect(byName.get_code_graph_freshness.requiredCapability).toBe("view_platform");
    expect(byName.get_code_graph_freshness.buildPhases).toEqual(["plan", "review", "ship"]);
    expect(byName.search_code_graph.buildPhases).toEqual(["ideate", "plan", "build", "review", "ship"]);
    expect(byName.trace_code_surface.buildPhases).toEqual(["ideate", "plan", "build", "review", "ship"]);
    expect(byName.find_related_tests.buildPhases).toEqual(["build", "review", "ship"]);
    expect(byName.analyze_reusability.buildPhases).toEqual(["ideate"]);
  });

  it("grants mirror agent-grants for every tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(codeIntelligencePack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

const CORPUS_AVAILABLE = { available: true, root: "/repo", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: [], fileCount: 2, reason: "Searched 2 markdown file(s)." };
const CORPUS_ABSENT = { available: false, root: "/app", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], fileCount: 0, reason: "No spec/plan corpus on this install." };

describe("code-intelligence pack — handler behavior (delegation preserved)", () => {
  it("search_specs_and_plans forwards the query and reports match count", async () => {
    specPlan.searchSpecsAndPlans.mockResolvedValue({
      corpus: CORPUS_AVAILABLE,
      results: [{ path: "a" }, { path: "b" }],
    });
    const res = await codeIntelligencePack.handlers.search_specs_and_plans(
      { query: "governance", kind: "spec", matches: 5, itemId: "BI-1", epicId: "EP-1" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 2 match(es).");
    expect(specPlan.searchSpecsAndPlans).toHaveBeenCalledWith({
      query: "governance",
      kind: "spec",
      matches: 5,
      itemId: "BI-1",
      epicId: "EP-1",
    });
  });

  it("search_specs_and_plans rejects when query and both narrowing ids are absent", async () => {
    const res = await codeIntelligencePack.handlers.search_specs_and_plans({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("missing_query");
    expect(specPlan.searchSpecsAndPlans).not.toHaveBeenCalled();
  });

  // BI-10C34BE1: an install without docs/superpowers answered every query with
  // an empty success, which reads as "no prior design exists" and defeats the
  // pre-filing overlap check.
  it("search_specs_and_plans fails loudly when the corpus is absent instead of returning an empty success", async () => {
    specPlan.searchSpecsAndPlans.mockResolvedValue({ corpus: CORPUS_ABSENT, results: [] });
    const res = await codeIntelligencePack.handlers.search_specs_and_plans({ query: "tunnel" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("spec_plan_corpus_unavailable");
    expect(res.message).toContain("NOT EVIDENCE");
    expect((res.data as { corpusAvailable: boolean }).corpusAvailable).toBe(false);
  });

  it("search_specs_and_plans reports a real no-match as a trustworthy empty success", async () => {
    specPlan.searchSpecsAndPlans.mockResolvedValue({ corpus: CORPUS_AVAILABLE, results: [] });
    const res = await codeIntelligencePack.handlers.search_specs_and_plans({ query: "tunnel" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 0 match(es).");
    expect((res.data as { corpusAvailable: boolean }).corpusAvailable).toBe(true);
  });

  it("get_code_graph_freshness returns the summary when there is no trust vector", async () => {
    codeGraphAccess.getCodeGraphFreshness.mockResolvedValue({ trust: null, summary: "graph is fresh" });
    const res = await codeIntelligencePack.handlers.get_code_graph_freshness({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("graph is fresh");
    expect(trustVector.buildTrustMessage).not.toHaveBeenCalled();
  });

  it("get_code_graph_freshness routes through buildTrustMessage when a trust vector is present", async () => {
    codeGraphAccess.getCodeGraphFreshness.mockResolvedValue({ trust: { level: "high" }, summary: "s" });
    trustVector.buildTrustMessage.mockReturnValue("trusted: s");
    const res = await codeIntelligencePack.handlers.get_code_graph_freshness({}, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("trusted: s");
    expect(trustVector.buildTrustMessage).toHaveBeenCalled();
  });

  it("search_code_graph delegates and surfaces the graph summary", async () => {
    graphQueries.searchCodeGraph.mockResolvedValue({ available: true, summary: "3 hits" });
    const res = await codeIntelligencePack.handlers.search_code_graph({ query: "prisma", limit: 5 }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("3 hits");
    expect(graphQueries.searchCodeGraph).toHaveBeenCalledWith({
      query: "prisma",
      graphKey: undefined,
      limit: 5,
    });
  });

  it("search_code_graph reports unavailability as a failure", async () => {
    graphQueries.searchCodeGraph.mockResolvedValue({ available: false, summary: "graph not built" });
    const res = await codeIntelligencePack.handlers.search_code_graph({ query: "x" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Code graph unavailable");
    expect(res.message).toBe("graph not built");
  });

  it("trace_code_surface forwards route/tool/model and graphKey", async () => {
    graphQueries.traceCodeSurface.mockResolvedValue({ available: true, summary: "traced" });
    const res = await codeIntelligencePack.handlers.trace_code_surface(
      { route: "/build", graphKey: "gk" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(graphQueries.traceCodeSurface).toHaveBeenCalledWith({
      route: "/build",
      tool: undefined,
      model: undefined,
      graphKey: "gk",
    });
  });

  it("find_related_tests delegates for a file path", async () => {
    graphQueries.findRelatedTests.mockResolvedValue({ available: true, summary: "2 tests" });
    const res = await codeIntelligencePack.handlers.find_related_tests(
      { filePath: "apps/web/lib/foo.ts" },
      "u1",
    );
    expect(res.success).toBe(true);
    expect(res.message).toBe("2 tests");
    expect(graphQueries.findRelatedTests).toHaveBeenCalledWith({
      filePath: "apps/web/lib/foo.ts",
      graphKey: undefined,
      limit: undefined,
    });
  });

  it("analyze_reusability flags proper-noun/acronym concepts as parameterizable", async () => {
    const res = await codeIntelligencePack.handlers.analyze_reusability(
      { featureDescription: "ITIL change flow", domainConcepts: ["ITIL", "quarterly"], userScope: "parameterizable" },
      "u1",
    );
    expect(res.success).toBe(true);
    const data = res.data as { domainEntities: unknown[]; contributionReadiness: string };
    expect(data.domainEntities).toHaveLength(1);
    expect(data.contributionReadiness).toBe("medium");
    expect(canonical.matchCanonicalPrimitives).toHaveBeenCalled();
  });

  it("analyze_reusability rates an already-generic feature as high readiness", async () => {
    const res = await codeIntelligencePack.handlers.analyze_reusability(
      { featureDescription: "generic table", domainConcepts: [], userScope: "already_generic" },
      "u1",
    );
    const data = res.data as { contributionReadiness: string };
    expect(data.contributionReadiness).toBe("high");
  });
});
