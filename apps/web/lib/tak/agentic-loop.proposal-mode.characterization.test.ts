// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S1.
//
// Pins what a proposal-mode tool does in the agentic loop TODAY, before the
// chat path converges on the envelope (plan PR-A A1; spec §3.1 S1, D2):
//   - the loop returns `agenticResult.proposal` BEFORE governedExecuteTool
//     for autonomous callers (chat moved to the envelope in PR-B);
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
vi.mock("@/lib/work-management/room-stage-mandate", () => ({ loadScheduledRoomMandateLive: vi.fn(async () => []) }));

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
  // PR-B (BI-7BCC87BB) moved chat to the envelope; see the S1 chat block below.
  it.each(["autonomous"] as const)(
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
    const result = await runAgenticLoop(params("autonomous"));
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
  { file: "lib/tak/child-thread-runtime.ts", proposalReads: [] },
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

  // PR-B named delta (BI-7BCC87BB): the chat caller no longer persists a
  // proposal; it renders the approval requests the monitor raised.
  it("the chat caller persists no proposal-mode call; it ends on the pending approval", () => {
    const source = readFileSync(join(WEB_ROOT, "lib/actions/agent-coworker.ts"), "utf8");
    // Clearing a conversation still deletes legacy rows (FK on messageId); nothing creates one.
    expect(source).not.toMatch(/agentActionProposal\.create/);
    expect(source).not.toContain('const proposalId = "AP-" +');
    expect(source).toContain("agenticResult.pendingApproval");
  });
});

// PR-B (BI-7BCC87BB; spec D2 S1, AC-RAISE, AC-RUN wired): in chat a
// proposal-mode call goes to the governed executor, which raises the
// approval request bound to the exact call. The turn ends on it.
describe("S1 — a proposal-mode tool in chat raises an approval request", () => {
  function pending(envelopeId: string) {
    return {
      success: false,
      error: "approval_required",
      message: "contribute_to_hive is waiting for a person to approve it.",
      data: { envelopeId, expiresAt: "2026-10-07T12:15:00.000Z" }, // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
      governance: { rejected: "approval_required" },
    };
  }

  it("calls the governed executor with the platform completing the approval and the turn's message id", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference("I'd like to share this.", [CALL]) as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce(pending("env-1") as never);

    const result = await runAgenticLoop({ ...params("chat"), agentMessageId: "msg-turn-1" });

    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "contribute_to_hive",
      rawParams: { title: "Finding", body: "Details" },
      source: "agentic-loop",
      context: expect.objectContaining({
        agentId: "AGT-COWORKER", threadId: "thread-1",
        approvalCompletion: "platform", chatMessageId: "msg-turn-1",
      }),
    }));
    expect(result.proposal).toBeNull();
    expect(result.pendingApproval).toEqual({ envelopeIds: ["env-1"] });
    expect(result.content).toBe(pending("env-1").message);
    // The turn ends on the request: the model is not called again.
    expect(routeAndCall).toHaveBeenCalledTimes(1);
  });

  it("reports a declared proposal's actual wait even if the model claims it already completed", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference("I already shared it successfully.", [CALL]) as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce(pending("env-1") as never);
    const result = await runAgenticLoop(params("chat"));
    expect(result.content).toBe(pending("env-1").message);
    expect(result.pendingApproval).toEqual({ envelopeIds: ["env-1"] });
    expect(routeAndCall).toHaveBeenCalledOnce();
  });

  it("ends the step on the first request raised: later calls from the same model batch are not run", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference("", [CALL, { ...CALL, id: "c2", arguments: { title: "Second", body: "More" } }]) as never);
    vi.mocked(governedExecuteTool)
      .mockResolvedValueOnce(pending("env-1") as never)
      .mockResolvedValueOnce(pending("env-2") as never);
    const result = await runAgenticLoop({ ...params("chat"), agentMessageId: "msg-turn-1" });
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(result.pendingApproval).toEqual({ envelopeIds: ["env-1"] });
    expect(result.executedTools.map((tool) => tool.args)).toEqual([{ title: "Finding", body: "Details" }]);
    expect(result.content).toBe(pending("env-1").message);
    expect(routeAndCall).toHaveBeenCalledTimes(1);
  });

  it("a settled call (it already ran on an approval) renders its recorded outcome and raises no card", async () => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(inference("Sharing.", [CALL]) as never)
      .mockResolvedValueOnce(inference("It was already shared.") as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({
      success: true, message: "contribute_to_hive already ran once after a person approved it.",
      governance: { approvalReplayOf: "env-0" },
    } as never);
    const result = await runAgenticLoop({ ...params("chat"), agentMessageId: "msg-turn-1" });
    expect(result.pendingApproval).toBeUndefined();
    expect(result.content).toBe("It was already shared.");
  });

  it("autonomous callers keep the pinned behaviour: no governed call, a proposal, no pending approval", async () => {
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference("Proposing.", [CALL]) as never);
    const result = await runAgenticLoop({ ...params("autonomous"), agentMessageId: "msg-turn-1" });
    expect(governedExecuteTool).not.toHaveBeenCalled();
    expect(result.proposal?.name).toBe("contribute_to_hive");
    expect(result.pendingApproval).toBeUndefined();
  });
});

// PR-B (BI-7BCC87BB; spec D2 S2, AC-BOUNDARY): under a propose boundary the
// loop hands a side-effecting call to the governed executor with the boundary
// set, so the monitor raises the request; the run carries on.
describe("S2 — the loop sends a propose-boundary call through the monitor", () => {
  const WRITE = { id: "w1", name: "run_discovery_triage", arguments: { scope: "daily" } };
  function writeTool() {
    return { name: "run_discovery_triage", description: "Run triage", inputSchema: {}, requiredCapability: null, executionMode: "immediate" as const, sideEffect: true };
  }

  it.each([
    ["autonomous", undefined],
    ["chat", "msg-turn-1"],
  ] as const)("%s: one governed call with proposeBoundary, then the run continues", async (mode, chatMessageId) => {
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(inference("Triaging.", [WRITE]) as never)
      .mockResolvedValueOnce(inference("Proposed the triage run.") as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({
      success: false, error: "approval_required", message: "waiting",
      data: { envelopeId: "env-9", expiresAt: "2026-10-14T08:00:00.000Z" }, governance: { rejected: "approval_required" }, // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
    } as never);

    const result = await runAgenticLoop({
      ...params(mode, writeTool() as never),
      toolsForProvider: [{ type: "function", function: { name: "run_discovery_triage", description: "x", parameters: {} } }],
      proposeSideEffects: true,
      taskRunId: "TR-SCHED-1",
      ...(chatMessageId ? { agentMessageId: chatMessageId } : {}),
    });

    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "run_discovery_triage",
      source: "agentic-loop",
      context: expect.objectContaining({
        taskRunId: "TR-SCHED-1", proposeBoundary: true, approvalCompletion: "platform",
        ...(chatMessageId ? { chatMessageId } : {}),
      }),
    }));
    expect(result.executedTools[0]?.result).toMatchObject({ success: true, entityId: "env-9", data: { status: "proposed" } });
    expect(result.content).toBe("Proposed the triage run.");
    expect(result.pendingApproval).toBeUndefined();
  });
});

// Ordinary immediate writes use the existing platform completion contract.
describe('BI-0B70FA79 ordinary immediate-call completion', () => {
  it.each(['chat', 'autonomous'] as const)('%s platform immediate calls retain a completion route if the monitor asks for approval', async mode => {
    const tool = { name: 'record_execution_evidence', description: 'Record ordinary evidence', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect: true };
    const call = { id: 'e1', name: tool.name, arguments: { itemId: 'BI-FIXTURE', kind: 'manual_check', summary: 'Fixture only' } };
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('Recording.', [call]) as never).mockResolvedValue(inference('This request is waiting for the recorded approval outcome. '.repeat(20)) as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({ success: false, error: 'approval_required', message: 'waiting', data: { envelopeId: 'ENV-DIAGNOSTIC' } } as never);
    await runAgenticLoop({ ...params(mode, tool as never), taskRunId: mode === 'autonomous' ? 'TR-FIXTURE' : undefined });
    expect(governedExecuteTool).toHaveBeenCalledOnce();
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].context?.approvalCompletion).toBe('platform');
  });
  it('external-token immediate calls keep credential-bound completion', async () => {
    const tool = { name: 'record_execution_evidence', description: 'Record evidence', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect: true };
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('Recording.', [{ id: 'e2', name: tool.name, arguments: {} }]) as never).mockResolvedValueOnce(inference('Done.') as never);
    await runAgenticLoop({ ...params('autonomous', tool as never), apiTokenId: 'TOKEN-FIXTURE', taskRunId: 'TR-FIXTURE' });
    expect(governedExecuteTool).toHaveBeenCalledOnce();
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].context).toMatchObject({ apiTokenId: 'TOKEN-FIXTURE', taskRunId: 'TR-FIXTURE' });
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].context?.approvalCompletion).toBeUndefined();
  });
  it.each([
    ['read', undefined, false, {}],
    ['blank-token', '', true, {}],
    ['whitespace-token', '   ', true, {}],
    ['external-argument-claim', 'TOKEN-FIXTURE', true, { approvalCompletion: 'platform' }],
  ] as const)('%s cannot acquire the new platform write marker', async (_kind, apiTokenId, sideEffect, args) => {
    const tool = { name: 'fixture_operation', description: 'Fixture only', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect };
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('Checking.', [{ id: 'ctrl', name: tool.name, arguments: args }]) as never).mockResolvedValueOnce(inference('The fixture completed through its existing context. '.repeat(10)) as never);
    await runAgenticLoop({ ...params('autonomous', tool as never), apiTokenId });
    expect(governedExecuteTool).toHaveBeenCalledOnce();
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].context?.approvalCompletion).toBeUndefined();
  });
  it('retains the assigned run and original captured execution fence on the platform write', async () => {
    const tool = { name: 'record_execution_evidence', description: 'Fixture only', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect: true };
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: 'original', dispatchClaim: null, authorityDigest: null, requestDigest: 'a'.repeat(64) };
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('Recording.', [{ id: 'fence', name: tool.name, arguments: {} }]) as never).mockResolvedValueOnce(inference('The fixture completed through its existing context. '.repeat(10)) as never);
    await runAgenticLoop({ ...params('autonomous', tool as never), taskRunId: 'TR-FIXTURE', taskExecutionFence, tokenScope: 'write' });
    expect(governedExecuteTool).toHaveBeenCalledOnce();
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].context).toMatchObject({ taskRunId: 'TR-FIXTURE', taskExecutionFence, tokenScope: 'write', approvalCompletion: 'platform' });
  });
});

describe('BI-0B70FA79 ordinary pending batch', () => {
  it.each(['chat','autonomous'] as const)('%s stops the batch and reports the actual wait', async mode => {
    const tool = { name: 'fixture_internal_write', description: 'Fixture only', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect: true };
    const first = { id: 'pending-first', name: tool.name, arguments: { step: 1 } };
    const later = { id: 'must-not-run', name: tool.name, arguments: { step: 2 } };
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('Both fixture writes completed.', [first, later]) as never)
      .mockResolvedValue(inference('Both fixture writes completed. '.repeat(20)) as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({ success: false, error: 'approval_required', message: 'Waiting on the recorded owner decision.', data: { envelopeId: 'ENV-PENDING-FIXTURE' } } as never)
      .mockResolvedValue({ success: true, message: 'Second fixture call ran.' } as never);
    const result = await runAgenticLoop(params(mode, tool as never));
    expect.soft(governedExecuteTool).toHaveBeenCalledOnce();
    expect.soft(routeAndCall).toHaveBeenCalledOnce();
    expect.soft(result.pendingApproval).toEqual({ envelopeIds: ['ENV-PENDING-FIXTURE'] });
    expect.soft(result.content).not.toContain('Both fixture writes completed.');
  });
  it('uses the exact pending call after an earlier successful call of the same tool', async () => {
    const tool = { name: 'fixture_internal_write', description: 'Fixture only', inputSchema: {}, requiredCapability: null, executionMode: 'immediate' as const, sideEffect: true };
    const calls = [0,1,2].map(step => ({ id: 'call-' + step, name: tool.name, arguments: { step } }));
    vi.mocked(routeAndCall).mockResolvedValueOnce(inference('All fixture writes completed.', calls) as never).mockResolvedValue(inference('All fixture writes completed. '.repeat(20)) as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({ success: true, message: 'Only first write completed.' } as never)
      .mockResolvedValueOnce({ success: false, error: 'approval_required', message: 'Second write is waiting for owner approval.', data: { envelopeId: 'ENV-SECOND' } } as never)
      .mockResolvedValue({ success: true, message: 'Third write ran.' } as never);
    const result = await runAgenticLoop(params('chat', tool as never));
    expect.soft(governedExecuteTool).toHaveBeenCalledTimes(2);
    expect.soft(routeAndCall).toHaveBeenCalledOnce();
    expect.soft(result.executedTools.map(x => x.args)).toEqual([{ step: 0 }, { step: 1 }]);
    expect.soft(result.pendingApproval).toEqual({ envelopeIds: ['ENV-SECOND'] });
    expect.soft(result.content).toBe('Second write is waiting for owner approval.');
  });

});
