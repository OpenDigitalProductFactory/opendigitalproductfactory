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
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";

const writer = "record_initiative_design_review";
const reply = (truncated: boolean, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []) => ({
  content: "Partial assessment", truncated, toolCalls, inputTokens: 10, outputTokens: 4096,
  providerId: "local", modelId: "review-model", downgraded: false,
  downgradeMessage: null, toolsStripped: false, routeDecision: {},
});
const params = {
  chatHistory: [{ role: "user" as const, content: "Review the bound evidence." }],
  systemPrompt: "Record your independent assessment.", sensitivity: "confidential" as const,
  tools: [{ name: writer, description: "Record review", inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: true }],
  toolsForProvider: [{ type: "function", function: { name: writer, parameters: {} } }],
  userId: "user-1", agentId: "reviewer", threadId: "thread-1", routeContext: "/review",
  taskType: "external-mcp", interactionMode: "autonomous" as const,
  terminalToolPolicy: { writerToolName: writer, readerToolNames: ["read_source_at_version"],
    minimumSuccessfulReaderCalls: 1, maximumReaderCalls: 3,
    terminalPhase: "writer-only" as const, persistedEvidenceAvailable: true },
};

describe("terminal writer output truncation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "Receipt recorded." });
  });

  it("continues truncation with the same sole required writer before judging prose", async () => {
    const calls: unknown[] = [];
    vi.mocked(routeAndCall).mockImplementation(async (...args) => {
      calls.push(structuredClone(args[3]));
      return (calls.length === 1 ? reply(true) : calls.length === 2 ? reply(false, [{ id: "write-1", name: writer, arguments: { decision: "pass" } }]) : reply(false)) as never;
    });
    const outcome = await runAgenticLoop(params);
    expect(calls).toHaveLength(3);
    for (const options of calls.slice(0, 2)) expect(options).toMatchObject({
      tools: params.toolsForProvider, toolChoice: "required", terminalWriterToolName: writer,
    });
    expect(calls[1]).not.toHaveProperty("deniedProviders");
    expect(vi.mocked(routeAndCall).mock.calls[1][0].at(-1)?.content).toContain(writer);
    expect(vi.mocked(routeAndCall).mock.calls[1][0].some(message =>
      typeof message.content === "string" && message.content.includes("output-token limit"))).toBe(true);
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(outcome.failure).toBeUndefined();
  });

  it("stops after two continuations without labelling exhaustion as prose noncompliance", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(reply(true) as never);
    const outcome = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(3);
    expect(governedExecuteTool).not.toHaveBeenCalled();
    expect(outcome.failure?.kind).toBe("terminal-writer-missing");
    expect(outcome.content).toContain("output-token limit");
    expect(outcome.content).not.toContain("did not honor");
  });

  it("keeps completed prose noncompliance unchanged", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(reply(false) as never);
    const outcome = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(outcome.content).toContain("did not honor");
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it("does not regenerate an already emitted tool call merely because output was truncated", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(reply(true, [{ id: "write-1", name: writer, arguments: { decision: "pass" } }]) as never)
      .mockResolvedValue(reply(false) as never);
    const outcome = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(outcome.failure).toBeUndefined();
  });

  it.each(["receipt", "approval"])("does not continue truncated prose after a persisted %s boundary", async (boundary) => {
    if (boundary === "approval") vi.mocked(governedExecuteTool).mockResolvedValue({
      success: false, message: "Approval pending.", error: "approval_required", data: { envelopeId: "ENV-1" },
    });
    vi.mocked(routeAndCall).mockResolvedValueOnce(reply(false, [{ id: "write-1", name: writer, arguments: {} }]) as never)
      .mockResolvedValue(reply(true) as never);
    const outcome = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(2);
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(outcome.failure).toBeUndefined();
    expect(outcome.executedTools[0].result.success).toBe(boundary === "receipt");
  });

  it("keeps a failed writer unverified when subsequent prose is truncated", async () => {
    vi.mocked(governedExecuteTool).mockResolvedValue({ success: false, message: "Receipt write failed.", error: "receipt_persistence_failed" });
    vi.mocked(routeAndCall).mockResolvedValueOnce(reply(false, [{ id: "write-1", name: writer, arguments: {} }]) as never)
      .mockResolvedValue(reply(true) as never);
    const outcome = await runAgenticLoop(params);
    expect(routeAndCall).toHaveBeenCalledTimes(4);
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(outcome.failure?.kind).toBe("terminal-writer-missing");
    expect(outcome.executedTools[0].result.success).toBe(false);
  });
});
