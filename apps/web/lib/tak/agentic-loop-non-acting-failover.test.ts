// DPF2-REMOVABLE bridge coverage. A `tool-action` turn that was handed real
// tools, invoked none, and closed with a guidance-only / "unavailable" reply is
// failed over ONCE to a different-adapter candidate: the non-acting provider is
// denied, exactly one re-dispatch happens, the failure is recorded, and a second
// non-acting answer returns the better of the two without a third attempt. These
// are unit tests that stub inference and the DB; they are not live routing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    platformIssueReport: { create: vi.fn() },
    coworkerTurnMetric: { upsert: vi.fn() },
    routeDecisionLog: { updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({
  PLATFORM_TOOLS: [],
  toolsToOpenAIFormat: vi.fn(() => []),
  executeTool: vi.fn(),
}));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/observability/heartbeat", () => ({
  heartbeat: vi.fn(async () => true),
  withHeartbeatTicker: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/routing/record-non-acting-failure", () => ({
  recordNonActingFailure: vi.fn(async () => {}),
}));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { recordNonActingFailure } from "@/lib/routing/record-non-acting-failure";
import { runAgenticLoop } from "./agentic-loop";

const toolName = "list_open_decision_reviews";

const params = {
  chatHistory: [{ role: "user" as const, content: "Open the pending COO decision reviews and summarize them." }],
  systemPrompt: "You are the COO coworker. Use the tool to open the decision reviews.",
  sensitivity: "internal" as const,
  tools: [{
    name: toolName, description: toolName, inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: false,
  }],
  toolsForProvider: [{ type: "function", function: { name: toolName, parameters: {} } }],
  userId: "user-coo",
  agentId: "AGT-COO",
  threadId: "thread-coo-review",
  routeContext: "/coworker-decisions/review",
  taskType: "tool-action",
  interactionMode: "autonomous" as const,
};

type ResultShape = {
  content: string;
  providerId: string;
  modelId: string;
  routeDecision: Record<string, unknown>;
};
const nonActing = (p: ResultShape) => ({
  content: p.content,
  providerId: p.providerId,
  modelId: p.modelId,
  toolCalls: [],
  inputTokens: 900,
  outputTokens: 120,
  downgraded: false,
  downgradeMessage: null,
  downgradeReason: null,
  toolsStripped: false,
  truncated: false,
  routeDecision: p.routeDecision,
});

// First answer is the LONGER one so "better of two" is a real choice, not "last".
const FIRST_CONTENT =
  "I looked into this, but the list_open_decision_reviews capability is currently " +
  "unavailable in this environment, so I could not open the reviews. Here is some " +
  "general guidance on how decision reviews usually work and what you might check.";
const SECOND_CONTENT = "That reviewer tool is unavailable right now.";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    isSuperuser: false,
    groups: [{ platformRole: { roleId: "developer" } }],
  } as never);
  vi.mocked(prisma.routeDecisionLog.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe("non-acting in-turn failover", () => {
  it("denies the non-acting provider, re-dispatches once to a different adapter, and returns the better of two", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(nonActing({
        content: FIRST_CONTENT,
        providerId: "codex",
        modelId: "gpt-5.6-luna",
        routeDecision: { selectedEndpoint: "codex:gpt-5.6-luna", executionPlan: { executionAdapter: "codex-cli" } },
      }) as never)
      .mockResolvedValueOnce(nonActing({
        content: SECOND_CONTENT,
        providerId: "openrouter",
        modelId: "claude-sonnet",
        routeDecision: { traceId: "trace-replacement", selectedEndpoint: "openrouter:claude-sonnet", executionPlan: { executionAdapter: "http-anthropic" } },
      }) as never);

    const result = await runAgenticLoop(params);

    // Exactly one re-dispatch — no third attempt after the second non-acting turn.
    expect(routeAndCall).toHaveBeenCalledTimes(2);

    // The non-acting provider was pushed onto deniedProviders for the re-dispatch.
    const secondCallOptions = vi.mocked(routeAndCall).mock.calls[1]![3] as { deniedProviders?: string[] };
    expect(secondCallOptions.deniedProviders).toContain("codex");

    // The failure was recorded against the exact endpoint + adapter.
    expect(recordNonActingFailure).toHaveBeenCalledTimes(1);
    expect(recordNonActingFailure).toHaveBeenCalledWith({
      providerId: "codex",
      modelId: "gpt-5.6-luna",
      adapter: "codex-cli",
      taskType: "tool-action",
    });

    // The failover was logged as a fallbacksUsed record on the replacement's decision.
    expect(prisma.routeDecisionLog.updateMany).toHaveBeenCalledTimes(1);
    const logArg = vi.mocked(prisma.routeDecisionLog.updateMany).mock.calls[0]![0] as {
      where: { traceId: string };
      data: { fallbacksUsed: Array<{ endpointId: string; error: string }> };
    };
    expect(logArg.where.traceId).toBe("trace-replacement");
    expect(logArg.data.fallbacksUsed[0]!.endpointId).toBe("codex:gpt-5.6-luna");
    expect(logArg.data.fallbacksUsed[0]!.error).toContain("codex-cli");
    expect(logArg.data.fallbacksUsed[0]!.error).toContain("openrouter:claude-sonnet");

    // Better of the two (the longer first answer) is returned.
    expect(result.content).toBe(FIRST_CONTENT);
  });
});
