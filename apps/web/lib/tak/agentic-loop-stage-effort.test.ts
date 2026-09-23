import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/inference/budget-gate", () => ({
  checkAgentBudgetFromRegistry: vi.fn(),
  writeBudgetEvent: vi.fn(async () => {}),
}));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { checkAgentBudgetFromRegistry, writeBudgetEvent } from "@/lib/inference/budget-gate";
import { TIER_MINIMUM_DIMENSIONS } from "@/lib/routing/quality-tiers";
import { deriveEffortWarrant } from "./effort-warrant";
import { runAgenticLoop } from "./agentic-loop";

const result = {
  content: "Done.", toolCalls: [], inputTokens: 10, outputTokens: 5, providerId: "codex", modelId: "m",
  downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {},
};
const params = {
  chatHistory: [{ role: "user" as const, content: "Sweep the horizon." }],
  systemPrompt: "Do the stage.", sensitivity: "internal" as const, tools: [], toolsForProvider: [],
  userId: "user-1", agentId: "compliance-officer", threadId: "thread-1", routeContext: "/ops/workrooms",
};
const routeOptions = () => vi.mocked(routeAndCall).mock.calls[0]?.[3] as Record<string, unknown>;

function budget(status: "ok" | "warning_80" | "warning_95") {
  vi.mocked(checkAgentBudgetFromRegistry).mockResolvedValue({
    status, actualTokens: 96, limitTokens: 100, ratioPercent: 96,
  } as never);
}

// Phase G (proactivity & capacity allocation §6.1) — a declared stage tier routes
// after the coworker's DB model config, and a high / governed floor is never
// demoted by spend-aware routing.
describe("agentic loop — declared stage effort routing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue({
      agentId: "compliance-officer", minimumTier: "adequate", budgetClass: "quality_first",
      pinnedProviderId: null, pinnedModelId: null,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
    vi.mocked(routeAndCall).mockResolvedValue(result as never);
  });

  it("an undeclared turn near budget is downgraded exactly as today", async () => {
    budget("warning_95");
    await runAgenticLoop({ ...params });
    expect(routeOptions().budgetClass).toBe("minimize_cost");
    expect(writeBudgetEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKind: "downgrade" }));
  });

  it("never demotes a high (governed) stage near budget, and floors it at frontier", async () => {
    budget("warning_95");
    await runAgenticLoop({ ...params, effortWarrant: deriveEffortWarrant({ declaredEffort: "high" }) });
    expect(routeOptions().budgetClass).toBe("quality_first");
    expect(routeOptions().minimumDimensions).toEqual(TIER_MINIMUM_DIMENSIONS.frontier);
    expect(writeBudgetEvent).not.toHaveBeenCalled();
  });

  it("routes a low stage to the cheapest capable model, keeping the coworker's DB floor", async () => {
    budget("ok");
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue({
      agentId: "compliance-officer", minimumTier: "strong", budgetClass: "quality_first",
      pinnedProviderId: null, pinnedModelId: null,
    } as never);
    await runAgenticLoop({ ...params, effortWarrant: deriveEffortWarrant({ declaredEffort: "low" }) });
    expect(routeOptions().budgetClass).toBe("minimize_cost");
    expect(routeOptions().minimumDimensions).toEqual(TIER_MINIMUM_DIMENSIONS.strong);
  });
});
