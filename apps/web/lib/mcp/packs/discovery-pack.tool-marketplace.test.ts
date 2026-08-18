import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/tool-marketplace-readiness", () => ({
  getToolMarketplaceReadiness: vi.fn().mockResolvedValue({
    summary: {
      total: 1,
      ready: 0,
      available: 0,
      needsSetup: 0,
      needsGrant: 0,
      blocked: 1,
    },
    entries: [
      {
        id: "build-studio-frontier-tool-model",
        kind: "model_requirement",
        name: "Build Studio Frontier Tool Model",
        description: "Model requirement",
        category: "model-routing",
        readiness: "blocked",
        readinessLabel: "Blocked",
        guidance: "Build Studio implementation needs an active frontier, tool-capable model.",
        href: "/platform/ai/providers",
        enables: ["Build Studio implementation"],
        missingSetup: ["Activate a frontier, tool-capable model provider"],
        missingGrants: [],
        relevantAgentIds: ["build-specialist", "coo"],
      },
    ],
  }),
}));

import { getToolMarketplaceReadiness } from "@/lib/actions/tool-marketplace-readiness";
import { executeTool, getAvailableTools } from "@/lib/mcp-tools";

describe("search_tool_marketplace", () => {
  const adminUser = {
    userId: "user-1",
    platformRole: "HR-000",
    isSuperuser: false,
  };

  it("is exposed as a read-only platform tool", async () => {
    const tools = await getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((candidate) => candidate.name === "search_tool_marketplace");

    expect(tool).toBeDefined();
    expect(tool).toMatchObject({
      requiredCapability: "view_platform",
      executionMode: "immediate",
      sideEffect: false,
      buildPhases: ["ideate", "plan", "build", "review", "ship"],
    });
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("delegates execution to the shared marketplace readiness resolver", async () => {
    const result = await executeTool(
      "search_tool_marketplace",
      {
        query: "Build Studio",
        includeKinds: ["model_requirement", "unknown"],
      },
      "user-1",
      { agentId: "coo" },
    );

    expect(getToolMarketplaceReadiness).toHaveBeenCalledWith({
      query: "Build Studio",
      agentId: "coo",
      includeKinds: ["model_requirement"],
      limit: 12,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        summary: { blocked: 1 },
        entries: [
          expect.objectContaining({
            id: "build-studio-frontier-tool-model",
            readiness: "blocked",
          }),
        ],
      },
    });
  });
});
