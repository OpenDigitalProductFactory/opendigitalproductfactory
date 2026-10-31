import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn(async () => null) },
  user: { findUnique: vi.fn(async () => ({ isSuperuser: true, groups: [] })) },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { routeAndCall } from "@/lib/routed-inference";
import { runAgenticLoop } from "./agentic-loop";
import { INV5_UNVERIFIED_MESSAGE } from "./evidence-requirement";

const draft = "There are nine pending approval requests. I read the live records and everything is verified. ".repeat(3);
const params = {
  chatHistory: [{ role: "user" as const, content: "How many pending approvals are there now?" }],
  systemPrompt: "Use authoritative live data.", sensitivity: "internal" as const,
  tools: [], toolsForProvider: [], userId: "user-1", agentId: "coo",
  threadId: "thread-evidence", agentMessageId: "message-evidence", routeContext: "/workspace/inbox",
  interactionMode: "chat" as const,
};

describe("exhausted live-evidence recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(routeAndCall).mockResolvedValue({ content: draft, toolCalls: [], inputTokens: 10, outputTokens: 5,
      providerId: "chatgpt", modelId: "test-model", downgraded: false, downgradeMessage: null,
      toolsStripped: false, routeDecision: {} } as never);
  });

  it("returns a typed failure and retains the unverified draft outside the factual reply", async () => {
    const result = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(result.content).toBe(INV5_UNVERIFIED_MESSAGE);
    expect(result.content).not.toContain("nine");
    expect(result).toMatchObject({ failure: { kind: "evidence-unavailable" }, withheldContent: draft });
  });

  it("does not classify an ordinary short social answer as an evidence failure", async () => {
    vi.mocked(routeAndCall).mockResolvedValue({ content: "Hello.", toolCalls: [], inputTokens: 10, outputTokens: 5,
      providerId: "chatgpt", modelId: "test-model", downgraded: false, downgradeMessage: null,
      toolsStripped: false, routeDecision: {} } as never);
    const result = await runAgenticLoop({ ...params, chatHistory: [{ role: "user", content: "Hello." }] });
    expect(result.content).toBe("Hello.");
    expect(result.failure).toBeUndefined();
    expect(result).not.toHaveProperty("withheldContent");
  });
});
