import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = vi.hoisted(() => ({
  searchPortfolioContext: vi.fn(),
  getToolMarketplaceReadiness: vi.fn(),
  createToolEvaluation: vi.fn(),
  mcpFindMany: vi.fn(),
  featureBuildFindUnique: vi.fn(),
  featureBuildFindFirst: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findMany: (...a: unknown[]) => svc.mcpFindMany(...a) },
    featureBuild: {
      findUnique: (...a: unknown[]) => svc.featureBuildFindUnique(...a),
      findFirst: (...a: unknown[]) => svc.featureBuildFindFirst(...a),
    },
  },
}));
vi.mock("@/lib/portfolio-search", () => ({
  searchPortfolioContext: (...a: unknown[]) => svc.searchPortfolioContext(...a),
}));
vi.mock("@/lib/actions/tool-marketplace-readiness", () => ({
  getToolMarketplaceReadiness: (...a: unknown[]) => svc.getToolMarketplaceReadiness(...a),
}));
vi.mock("@/lib/tool-evaluation-data", () => ({
  createToolEvaluation: (...a: unknown[]) => svc.createToolEvaluation(...a),
}));

import { discoveryPack } from "./discovery-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "search_portfolio_context",
  "search_integrations",
  "search_tool_marketplace",
  "evaluate_tool",
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("discovery pack — registration", () => {
  it("exposes exactly the four discovery & marketplace tools with a handler each", () => {
    expect(discoveryPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(discoveryPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of discoveryPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grants mirror agent-grants for every tool", () => {
    expect(discoveryPack.grants.search_portfolio_context).toEqual(["portfolio_read", "registry_read"]);
    expect(discoveryPack.grants.search_integrations).toEqual(["external_registry_search", "registry_read"]);
    expect(discoveryPack.grants.search_tool_marketplace).toEqual(["registry_read"]);
    expect(discoveryPack.grants.evaluate_tool).toEqual(["tool_evaluation_create"]);

    expect(isToolAllowedByGrants("search_portfolio_context", ["portfolio_read", "registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("search_integrations", ["external_registry_search", "registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("search_tool_marketplace", ["registry_read"])).toBe(true);
    expect(isToolAllowedByGrants("evaluate_tool", ["tool_evaluation_create"])).toBe(true);
  });
});

describe("discovery pack — handler behavior (delegation preserved)", () => {
  it("search_portfolio_context resolves portfolio via the active build and returns the match count", async () => {
    svc.featureBuildFindFirst.mockResolvedValue({ buildId: "FB-ACT" });
    svc.featureBuildFindUnique.mockResolvedValue({ portfolioId: "PF-1" });
    svc.searchPortfolioContext.mockResolvedValue({
      taxonomyMatches: [{}], productMatches: [], buildMatches: [{}], backlogMatches: [],
    });
    const res = await discoveryPack.handlers.search_portfolio_context({ query: "invoicing" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 2 related items.");
    expect(svc.searchPortfolioContext).toHaveBeenCalledWith("invoicing", "PF-1");
  });

  it("search_integrations queries active integrations and reports the result count", async () => {
    svc.mcpFindMany.mockResolvedValue([]);
    const res = await discoveryPack.handlers.search_integrations({ query: "payments" }, "u1", {});
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 0 integration(s).");
    expect(svc.mcpFindMany).toHaveBeenCalledTimes(1);
  });

  it("search_tool_marketplace defaults agentId to the caller context", async () => {
    svc.getToolMarketplaceReadiness.mockResolvedValue({ summary: {}, entries: [{}, {}] });
    const res = await discoveryPack.handlers.search_tool_marketplace({ query: "payroll" }, "u1", { agentId: "AGT-9" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Found 2 marketplace readiness entries.");
    const [arg] = svc.getToolMarketplaceReadiness.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({ query: "payroll", agentId: "AGT-9", limit: 12 });
  });

  it("evaluate_tool creates an evaluation and returns its id", async () => {
    svc.createToolEvaluation.mockResolvedValue("TE-42");
    const res = await discoveryPack.handlers.evaluate_tool(
      { toolName: "acme", toolType: "npm_package" },
      "actor-3",
      {},
    );
    expect(res.success).toBe(true);
    expect(res.entityId).toBe("TE-42");
    const [arg] = svc.createToolEvaluation.mock.calls[0] as [Record<string, unknown>];
    expect(arg).toMatchObject({ toolName: "acme", toolType: "npm_package", version: "latest", proposedBy: "actor-3" });
  });
});
