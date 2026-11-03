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
import { prisma } from "@dpf/db";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
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
    expect(result).toMatchObject({ failure: { kind: "evidence-unavailable" }, evidenceFailure: {
      observedToolExecutions: 0, observedSuccessfulToolExecutions: 0, recoveryNudges: 1,
      retention: { state: "unavailable", reason: "missing-task-binding" },
    } });
    expect(result.withheldContent).toContain(draft);
    await vi.waitFor(() => expect(prisma.coworkerTurnMetric.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ agentMessageId: "message-evidence", dispatches: 2, executedTools: 0, nudges: 1 }),
    })));
    expect(JSON.stringify(vi.mocked(prisma.coworkerTurnMetric.upsert).mock.calls)).not.toContain(draft);
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

  it("retains both unverified final-answer drafts without placing either in the reply", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce({ content: draft + "FIRST", toolCalls: [], inputTokens: 1, outputTokens: 1,
      providerId: "chatgpt", modelId: "test", downgraded: false, downgradeMessage: null, toolsStripped: false, routeDecision: {} } as never);
    const result = await runAgenticLoop(params);
    expect(result.withheldContent).toContain("FIRST");
    expect(result.withheldContent).toContain(draft);
    expect(result.content).not.toContain("FIRST");
  });

  it.each([true, false])("requires a successful authoritative read, not merely a called tool (success=%s)", async success => {
    const name = "get_my_approval_status";
    vi.mocked(routeAndCall).mockResolvedValueOnce({ content: "Checking.", toolCalls: [{ id: "read-1", name, arguments: { mode: "pending" } }],
      inputTokens: 1, outputTokens: 1, providerId: "chatgpt", modelId: "test", downgraded: false, downgradeMessage: null,
      toolsStripped: false, routeDecision: {} } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue(success ? { success: true, message: "Scoped approvals read.", data: { approvals: [] } }
      : { success: false, error: "read_failed", message: "Read failed." });
    const result = await runAgenticLoop({ ...params, tools: [{ name, description: "Read approvals", inputSchema: {},
      requiredCapability: null, executionMode: "immediate", sideEffect: false }],
      toolsForProvider: [{ type: "function", function: { name, parameters: {} } }] });
    if (success) { expect(result.failure).toBeUndefined(); expect(result.content).toBe(draft); }
    else expect(result).toMatchObject({ failure: { kind: "evidence-unavailable" }, evidenceFailure: {
      observedToolExecutions: 1, observedSuccessfulToolExecutions: 0,
    } });
  });

  it("does not treat successful tool discovery as verified live data", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce({ content: "Discovering.",
      toolCalls: [{ id: "discover-1", name: "load_tools", arguments: { names: ["get_my_approval_status"] } }],
      inputTokens: 1, outputTokens: 1, providerId: "chatgpt", modelId: "test", downgraded: false,
      downgradeMessage: null, toolsStripped: false, routeDecision: {} } as never);
    const result = await runAgenticLoop(params);
    expect(result.failure?.kind).toBe("evidence-unavailable");
    expect(result.evidenceFailure?.observedSuccessfulToolExecutions).toBe(0);
    expect(governedExecuteTool).not.toHaveBeenCalled();
    expect(result.content).not.toContain("nine");
  });

  it("does not turn unsettled tool execution into an ordinary failed lookup", async () => {
    const name = "get_my_approval_status";
    vi.mocked(routeAndCall).mockResolvedValueOnce({ content: "Checking.", toolCalls: [{ id: "uncertain-read", name, arguments: { mode: "pending" } }],
      inputTokens: 1, outputTokens: 1, providerId: "chatgpt", modelId: "test", downgraded: false, downgradeMessage: null,
      toolsStripped: false, routeDecision: {} } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: false, error: "execution_uncertain",
      message: "The execution has no settled result.", data: { executionUncertainty: { schemaVersion: 1, settlement: "unknown" } } });
    const result = await runAgenticLoop({ ...params, tools: [{ name, description: "Read approvals", inputSchema: {},
      requiredCapability: null, executionMode: "immediate", sideEffect: false }],
      toolsForProvider: [{ type: "function", function: { name, parameters: {} } }] });
    expect(result.failure?.kind).toBe("execution-uncertain");
    expect(result.content).toContain("no verified settled result");
  });
});
