import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { runAgenticLoop } from "./agentic-loop";

const result = (content: string) => ({
  content, toolCalls: [], inputTokens: 10, outputTokens: 5, providerId: "codex", modelId: "test-model",
  downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {},
});
const params = {
  chatHistory: [{ role: "user" as const, content: "Hello." }],
  systemPrompt: "Answer briefly.", sensitivity: "internal" as const,
  tools: [], toolsForProvider: [],
  userId: "user-1", agentId: "software-engineer", threadId: "thread-1", routeContext: "/build",
};

// BI-CCF1ACBB: the loop is the one caller that knows the thread. It already put
// threadId on mcpSession (for the CLI adapter's JWT); the route options never
// carried it, so telemetry rows could not join the per-thread cost ledger.
describe("agentic loop thread attribution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
  });

  it("puts the thread on the route options so telemetry rows can join the cost ledger", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(result("Done.") as never);

    await runAgenticLoop({ ...params });

    expect(vi.mocked(routeAndCall).mock.calls[0]?.[3]).toMatchObject({
      agentId: "software-engineer",
      threadId: "thread-1",
      mcpSession: expect.objectContaining({ threadId: "thread-1" }),
    });
  });
});
