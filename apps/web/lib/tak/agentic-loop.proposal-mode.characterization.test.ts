// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S1.
//
// Pins what a proposal-mode tool does in the agentic loop TODAY, before the
// chat path converges on the envelope (plan PR-A A1; spec §3.1 S1, D2):
//   - the loop returns `agenticResult.proposal` BEFORE governedExecuteTool;
//   - an `autoApproveWhen` that is true falls through to the governed gate;
//   - every autonomous caller of the loop ends on a proposal and persists
//     nothing (FU-7). PR-B must leave these cases unchanged; only the chat
//     persistence (agent-coworker.proposal.characterization.test.ts) moves.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: vi.fn() },
    toolExecution: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    platformIssueReport: { create: vi.fn() },
    coworkerTurnMetric: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: vi.fn(), PLATFORM_TOOLS: [] }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { routeAndCall } from "@/lib/routed-inference";

import { runAgenticLoop } from "./agentic-loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, "..", "..");

function inference(content: string, toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []) {
  return {
    content,
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    downgraded: false,
    downgradeMessage: null,
    downgradeReason: null,
    toolsStripped: false,
    truncated: false,
    inputTokens: 10,
    outputTokens: 5,
    toolCalls,
    routeDecision: {} as never,
    responseId: undefined,
  };
}

function proposalTool(autoApproveWhen?: () => Promise<boolean>) {
  return {
    name: "contribute_to_hive",
    description: "Contribute a finding to the hive",
    inputSchema: {},
    requiredCapability: null,
    executionMode: "proposal" as const,
    sideEffect: true,
    ...(autoApproveWhen ? { autoApproveWhen } : {}),
  };
}

function params(interactionMode: "chat" | "autonomous", tool = proposalTool()) {
  return {
    chatHistory: [{ role: "user" as const, content: "share the finding" }],
    systemPrompt: "You are a coworker.",
    sensitivity: "internal" as const,
    tools: [tool],
    toolsForProvider: [{ type: "function", function: { name: tool.name, description: "x", parameters: {} } }],
    userId: "user-1",
    routeContext: "/platform/ai",
    agentId: "AGT-COWORKER",
    threadId: "thread-1",
    interactionMode,
  };
}

const CALL = { id: "c1", name: "contribute_to_hive", arguments: { title: "Finding", body: "Details" } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.toolExecution.create).mockResolvedValue({} as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true, groups: [] } as never);
  vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "Contributed", entityId: "HIVE-1" });
});

describe("S1 — a proposal-mode tool in the agentic loop (characterisation)", () => {
  it.each(["chat", "autonomous"] as const)(
    "%s: returns the call as agenticResult.proposal and never reaches the governed executor",
    async (mode) => {
      vi.mocked(routeAndCall).mockResolvedValueOnce(inference("I'd like to share this.", [CALL]) as never);

      const result = await runAgenticLoop(params(mode));

      expect(result.proposal).toEqual({
        name: "contribute_to_hive",
        arguments: { title: "Finding", body: "Details" },
        content: "I'd like to share this.",
      });
      expect(result.content).toBe("I'd like to share this.");
      expect(governedExecuteTool).not.toHaveBeenCalled();
      expect(routeAndCall).toHaveBeenCalledTimes(1);
    },
  );

  it("words the turn from the tool name when the model wrote no text", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference("", [CALL]) as never);
    const result = await runAgenticLoop(params("chat"));
    expect(result.content).toBe("I'd like to contribute to hive with the following details.");
    expect(result.proposal?.content).toBe("");
  });

  it("an autoApproveWhen that is true falls through to the governed executor", async () => {
    const autoApproveWhen = vi.fn().mockResolvedValue(true);
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(inference("Sharing now.", [CALL]) as never)
      .mockResolvedValueOnce(inference("Shared it.") as never);

    const result = await runAgenticLoop(params("chat", proposalTool(autoApproveWhen)));

    expect(autoApproveWhen).toHaveBeenCalledWith({ userId: "user-1", params: { title: "Finding", body: "Details" } });
    expect(result.proposal).toBeNull();
    expect(governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "contribute_to_hive",
      rawParams: { title: "Finding", body: "Details" },
      source: "agentic-loop",
      context: expect.objectContaining({ agentId: "AGT-COWORKER", threadId: "thread-1" }),
    }));
  });

  it("an autoApproveWhen that throws or is false still returns the proposal", async () => {
    for (const autoApproveWhen of [vi.fn().mockRejectedValue(new Error("config down")), vi.fn().mockResolvedValue(false)]) {
      vi.mocked(routeAndCall).mockResolvedValueOnce(inference("Proposing.", [CALL]) as never);
      const result = await runAgenticLoop(params("autonomous", proposalTool(autoApproveWhen)));
      expect(result.proposal?.name).toBe("contribute_to_hive");
    }
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });
});

// Every autonomous caller of the loop drops a proposal: none reads
// `.proposal`, and none persists an AgentActionProposal. The autonomous work
// run reads it only to skip its deliberation pass (autonomous-work-run.ts).
// These are source pins because the callers' harnesses do not reach the loop;
// the loop-level behaviour they depend on is pinned above.
const AUTONOMOUS_CALLERS: Array<{ file: string; proposalReads: string[] }> = [
  { file: "lib/actions/agent-task-scheduler.ts", proposalReads: [] },
  { file: "lib/actions/agent-thread-dispatcher-runtime.ts", proposalReads: [] },
  { file: "lib/mcp-task-execution.ts", proposalReads: [] },
  { file: "lib/tak/autonomous-work-run.ts", proposalReads: ["if (result.content && !result.proposal) {"] },
  { file: "lib/coworker-lifecycle/certification-runner.ts", proposalReads: [] },
  { file: "lib/build/build-orchestrator.ts", proposalReads: [] },
  { file: "lib/build/build-pipeline.ts", proposalReads: [] },
  { file: "lib/build/coding-agent.ts", proposalReads: [] },
];

describe("S1 — autonomous loop callers drop a proposal and persist nothing (characterisation)", () => {
  it.each(AUTONOMOUS_CALLERS)("$file", ({ file, proposalReads }) => {
    const source = readFileSync(join(WEB_ROOT, file), "utf8");
    expect(source).not.toContain("agentActionProposal");
    const reads = source.split("\n").filter((line) => /\.proposal\b/.test(line)).map((line) => line.trim());
    expect(reads).toEqual(proposalReads);
  });

  it("only the chat caller persists a proposal-mode call", () => {
    const source = readFileSync(join(WEB_ROOT, "lib/actions/agent-coworker.ts"), "utf8");
    expect(source).toContain("if (agenticResult.proposal) {");
    expect(source).toContain('const proposalId = "AP-" +');
    expect(source).toContain("prisma.agentActionProposal.create(");
  });
});
