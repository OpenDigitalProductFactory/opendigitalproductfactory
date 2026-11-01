// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S1,
// chat persistence. What sendMessage writes TODAY when the loop returns a
// proposal-mode call. Before PR-B it wrote one `AP-` AgentActionProposal;
// PR-B changes exactly this (named delta: the proposal row becomes an
// envelope list on the message); the loop-level cases live in
// lib/tak/agentic-loop.proposal-mode.characterization.test.ts.
//
// The mock harness mirrors agent-coworker-external.test.ts (vitest mock
// harnesses are per-file; that file is at the module-size ceiling).
import { beforeEach, describe, expect, it, vi } from "vitest";
const foregroundBuild = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/build/build-orchestrator", () => ({ runBuildOrchestrator: foregroundBuild.run }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/agent-routing", () => ({
  resolveAgentForRoute: vi.fn(),
  generateCannedResponse: vi.fn(),
}));

vi.mock("@/lib/tak/agent-routing-server", () => ({
  resolveAgentForRouteWithPrompts: vi.fn(),
}));

vi.mock("@/lib/ai-provider-priority", () => ({
  NoAllowedProvidersForSensitivityError: class extends Error {},
  NoProvidersAvailableError: class extends Error {},
}));

vi.mock("@/lib/routed-inference", () => ({
  routeAndCall: vi.fn(),
  NoEligibleEndpointsError: class NoEligibleEndpointsError extends Error {},
}));

vi.mock("@/lib/ai-inference", () => ({
  logTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mcp-tools", () => ({
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
  executeTool: vi.fn(),
  PLATFORM_TOOLS: [],
}));

vi.mock("@/lib/mcp-governed-execute", () => ({
  governedExecuteTool: vi.fn(),
}));

// Spec 8.2: hands-on and web access resolve server-side from the Workroom + grants.
const roomAuthorityState = vi.hoisted(() => ({ web: false, handsOn: false }));
vi.mock("@/lib/work-management/room-turn-authority.server", () => ({
  loadRoomTurnAuthority: vi.fn(async () => ({
    workroomId: null, collaborationShape: null, workShapeKey: null, authorizedGrants: null, actionBoundary: null,
    externalAccess: { enabled: roomAuthorityState.web, reason: roomAuthorityState.web ? "web-search-grant" : "no-web-search-grant" },
    handsOn: { enabled: roomAuthorityState.handsOn, reason: roomAuthorityState.handsOn ? "room-action-boundary" : "no-authority-declared" },
    priority: null, prioritySource: null,
  })),
}));
const setRoomAuthority = (next: { web?: boolean; handsOn?: boolean }) =>
  Object.assign(roomAuthorityState, { web: Boolean(next.web), handsOn: Boolean(next.handsOn) });

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedCoworkerEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/route-context", () => ({
  getRouteDataContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/portal-context", () => ({
  resolvePortalContextEnvelope: vi.fn(),
}));

vi.mock("@/lib/wiki/recall", () => ({
  recallWikiContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/tak/governed-memory", () => ({
  buildGovernedMemoryContext: vi.fn().mockResolvedValue({
    factsContext: null,
    recalledContext: null,
  }),
}));

vi.mock("@/lib/semantic-memory", () => ({
  storeConversationMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/tak/user-facts", () => ({
  extractAndStoreFacts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/identity/aidoc-resolver", () => ({
  resolveAIDocForAgent: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/tak/reflection-triggers", () => ({
  processRuntimeIssueReflection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/tak/task-records", () => ({
  createTaskArtifact: vi.fn(),
}));

vi.mock("@/lib/work-capsules/work-capsule-store", () => ({
  recordWorkCapsuleEvidence: vi.fn(),
}));

vi.mock("@/lib/process-observer-hook", () => ({
  observeConversation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/task-classifier", () => ({
  classifyTask: vi.fn().mockReturnValue({ taskType: "conversation", confidence: 0.8, requiresCodeExecution: false, requiresWebSearch: false, requiresComputerUse: false }),
}));

vi.mock("@/lib/agent-router-data", () => ({
  loadPerformanceProfiles: vi.fn().mockResolvedValue([]),
  ensurePerformanceProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/feature-build-data", () => ({
  getFeatureBuildForContext: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/file-upload", () => ({
  deleteAttachmentsForThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/route-context-map", () => ({
  resolveRouteContext: vi.fn().mockReturnValue({
    routePrefix: "/admin",
    domain: "Administration",
    sensitivity: "restricted",
    domainContext: "Admin context",
    domainTools: [],
    skills: [],
  }),
}));

vi.mock("@/lib/prompt-assembler", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("assembled prompt"),
  assembleSystemPromptWithProvenance: vi.fn().mockResolvedValue({ text: "assembled prompt", instructionSpans: [] }),
}));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    ...actual,
    getGrantedCapabilities: vi.fn().mockReturnValue([]),
    getDeniedCapabilities: vi.fn().mockReturnValue([]),
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    user: {
      findUnique: vi.fn(),
    },
    agentThread: {
      findUnique: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    agentAttachment: {
      findMany: vi.fn(),
    },
    agent: {
      findUnique: vi.fn(),
    },
    organization: {
      findFirst: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(), update: vi.fn(),
    },
    scheduledJob: { deleteMany: vi.fn() },
    taskRun: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    backlogItem: {
      findUnique: vi.fn(),
    },
    backlogItemActivity: {
      create: vi.fn(),
    },
    agentActionProposal: {
      create: vi.fn(),
    },
    coworkerActionEnvelope: {
      findMany: vi.fn(),
    },
    agentModelConfig: {
      findUnique: vi.fn(),
    },
    toolExecution: {
      create: vi.fn(),
    },
    // Build Specialist Operator Contract (Slice 1) — sendMessage looks up the
    // active FeatureBuild by threadId so platform-side guards in the agentic
    // loop can attribute PlatformIssueReport rows. findFirst returns null on
    // non-build threads (the tests don't cover the build route).
    featureBuild: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    platformIssueReport: {
      create: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { routeAndCall } from "@/lib/routed-inference";
import { classifyTask } from "@/lib/task-classifier";
import { getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import { prisma } from "@dpf/db";
import { sendMessage } from "./agent-coworker";
import { withForegroundWork } from "@/lib/agent/foreground-work-context";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";

const mockPrisma = prisma as any;

beforeEach(() => {
  setRoomAuthority({});
  vi.clearAllMocks();
  vi.mocked(isUnifiedCoworkerEnabled).mockResolvedValue(false);
  mockPrisma.$transaction = vi.fn(async (write: (db: unknown) => Promise<unknown>) => write(mockPrisma));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: "run-record" }]);
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: false } } as never);
  vi.mocked(resolveAgentForRouteWithPrompts).mockResolvedValue({
    agentId: "admin-assistant", agentName: "Admin Assistant", agentDescription: "Admin help",
    canAssist: true, sensitivity: "restricted", systemPrompt: "Prompt", skills: [],
  } as never);
  mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
  mockPrisma.agentThread.findUnique.mockResolvedValue({ id: "thread-1", userId: "user-1" });
  mockPrisma.agentMessage.findMany.mockResolvedValue([]);
  mockPrisma.agentAttachment.findMany.mockResolvedValue([]);
  mockPrisma.agent.findUnique.mockResolvedValue(null);
  mockPrisma.organization.findFirst.mockResolvedValue(null);
  mockPrisma.taskRun.findFirst.mockResolvedValue({ taskRunId: "run-123" });
  mockPrisma.featureBuild.findUnique.mockResolvedValue(null);
  mockPrisma.agentModelConfig.findUnique.mockResolvedValue(null);
  mockPrisma.toolExecution.create.mockResolvedValue({});
  vi.mocked(resolvePortalContextEnvelope).mockResolvedValue(null as never);
  vi.mocked(classifyTask).mockReturnValue({
    taskType: "conversation", confidence: 0.8, requiresCodeExecution: false, requiresWebSearch: false, requiresComputerUse: false,
  } as never);
  vi.mocked(toolsToOpenAIFormat).mockReturnValue([]);
  mockPrisma.agentMessage.create
    .mockResolvedValueOnce({ id: "user-msg-1", role: "user", content: "Share it", agentId: null, routeContext: "/admin", createdAt: new Date("2026-10-07T00:00:00.000Z") })
    .mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id, role: "assistant", content: data.content, agentId: data.agentId, routeContext: data.routeContext,
      createdAt: new Date("2026-10-07T00:00:01.000Z"),
    }));
  mockPrisma.agentActionProposal.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    proposalId: data.proposalId, actionType: data.actionType, parameters: data.parameters,
    status: data.status, resultEntityId: null, resultError: null,
  }));
  vi.mocked(getAvailableTools).mockReturnValue([{
    name: "contribute_to_hive", description: "Contribute", inputSchema: {},
    requiredCapability: "view_platform", executionMode: "proposal", sideEffect: true,
  }] as never);
  vi.mocked(routeAndCall).mockResolvedValue({
    content: "I'd like to share this finding.",
    providerId: "ollama-local", modelId: "llama3.1", inputTokens: 1, outputTokens: 1,
    downgraded: false, downgradeMessage: null, routeDecision: {},
    toolCalls: [{ id: "c1", name: "contribute_to_hive", arguments: { title: "Finding", body: "Details" } }],
  } as never);
});

// PR-B named delta (BI-7BCC87BB; spec D2 S1, AC-RAISE): the proposal row
// becomes the approval request(s) the governed executor raised, shown inline
// on the assistant message by its pre-allocated id. No proposal is written.
describe("S1 — chat ends a proposal-mode call on the approval request it raised", () => {
  it("writes the assistant message at the pre-allocated id, no proposal, and lists the raised requests on it", async () => {
    vi.mocked(governedExecuteTool).mockResolvedValue({
      success: false, error: "approval_required", message: "contribute_to_hive is waiting for a person to approve it.",
      data: { envelopeId: "env-1", expiresAt: "2026-10-07T00:15:00.000Z" }, governance: { rejected: "approval_required" }, // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
    } as never);
    mockPrisma.coworkerActionEnvelope.findMany.mockImplementation(async ({ where }: { where: { chatMessageId: { in: string[] } } }) => [{
      id: "env-1", chatMessageId: where.chatMessageId.in[0], manifestActionId: "contribute_to_hive", status: "proposed",
      expiresAt: new Date("2026-10-07T00:15:00.000Z"), rationale: "This action is defined as a proposal, so a person decides it.", // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
    }]);

    const result = await sendMessage({ threadId: "thread-1", content: "Share it", routeContext: "/admin" });

    const messageWrite = mockPrisma.agentMessage.create.mock.calls[1][0].data;
    expect(messageWrite).toMatchObject({
      threadId: "thread-1", role: "assistant", taskRunId: "run-123",
      content: "contribute_to_hive is waiting for a person to approve it.", agentId: "admin-assistant", routeContext: "/admin",
    });
    expect(governedExecuteTool).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "contribute_to_hive",
      context: expect.objectContaining({ approvalCompletion: "platform", chatMessageId: messageWrite.id }),
    }));
    expect(mockPrisma.agentActionProposal.create).not.toHaveBeenCalled();
    expect("agentMessage" in result && result.agentMessage).toMatchObject({
      id: messageWrite.id,
      role: "assistant",
      content: "contribute_to_hive is waiting for a person to approve it.",
      approvalRequests: [{
        envelopeId: "env-1", toolName: "contribute_to_hive", status: "proposed",
        expiresAt: "2026-10-07T00:15:00.000Z", rationale: "This action is defined as a proposal, so a person decides it.", // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
      }],
    });
    expect("agentMessage" in result && result.agentMessage.proposal).toBeUndefined();
  });
});

describe("retained foreground production response publication", () => {
  function retainedTurn(routeContext = "/admin") {
    const run = { id: "run-record", taskRunId: "run-123", userId: "user-1", threadId: "thread-1", routeContext,
      initiatingAgentId: "admin-assistant", source: "coworker", status: "working", archivedAt: null,
      progressPayload: { dispatch: { claimedAt: "original" }, foregroundAttempt: 1 },
      a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64), foregroundRequest: {
        schemaVersion: 1, userMessageId: "user-msg-1", deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      } },
    };
    mockPrisma.taskRun.findUnique.mockImplementation(async () => structuredClone(run));
    mockPrisma.taskRun.updateMany.mockImplementation(async ({ data }: any) => {
      if (run.status !== "working") return { count: 0 };
      Object.assign(run, data);
      return { count: 1 };
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", isActive: true, isSuperuser: true, groups: [] });
    mockPrisma.agentMessage.findFirst.mockResolvedValue({ id: "user-msg-1", role: "user", content: "Share it", taskRunId: "run-123", createdAt: new Date() });
    const messages = new Map<string, any>();
    mockPrisma.agentMessage.findUnique.mockImplementation(async ({ where }: any) => messages.get(where.id) ?? null);
    mockPrisma.agentMessage.create.mockReset().mockImplementation(async ({ data }: any) => {
      const message = { ...data, id: data.id ?? "late-response", createdAt: new Date() };
      messages.set(message.id, message);
      return message;
    });
    vi.mocked(getAvailableTools).mockResolvedValue([]);
    return run;
  }

  it("retains a Build Studio request without starting an unbound native child", async () => {
    retainedTurn("/build/FB-controlled");
    mockPrisma.featureBuild.findFirst.mockResolvedValue({ buildId: "FB-controlled", phase: "build", threadId: "thread-1", buildPlan: { tasks: [{ id: "fixture", title: "Synthetic work" }] }, taskResults: null });
    mockPrisma.featureBuild.findUnique.mockResolvedValue({ buildId: "FB-controlled", phase: "build", threadId: "thread-1" });
    foregroundBuild.run.mockResolvedValue({ content: "Controlled native child result", totalInputTokens: 0, totalOutputTokens: 0 });
    const result = await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content: "Share it", routeContext: "/build/FB-controlled", acceptedUserMessageId: "user-msg-1" }));
    expect(foregroundBuild.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: expect.stringContaining("Build Studio") });
  });

  it.each([[true, false], [false, false], [true, true], [false, true]])("pins the accepted assignment once and marks older unanswered requests as context (window contains current: %s, unified: %s)", async (includesCurrent, unified) => {
    retainedTurn();
    vi.mocked(isUnifiedCoworkerEnabled).mockResolvedValue(unified);
    const content = "Separate task: draft a private agenda only. Do not resume the earlier approval check.";
    const accepted = { id: "user-msg-1", role: "user", content, taskRunId: "run-123", createdAt: new Date() };
    mockPrisma.agentMessage.findFirst.mockResolvedValue(accepted);
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      ...(includesCurrent ? [accepted] : []),
      { id: "old-unanswered", role: "user", content: "Check the earlier approval." },
    ]);
    vi.mocked(routeAndCall).mockResolvedValueOnce({ content: "Private agenda", providerId: "ollama-local", modelId: "fixture",
      inputTokens: 1, outputTokens: 1, downgraded: false, downgradeMessage: null, routeDecision: {} } as never);

    await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content, routeContext: "/admin", acceptedUserMessageId: accepted.id }));

    const [messages, prompt] = vi.mocked(routeAndCall).mock.calls[0]!;
    expect(messages.at(-1)).toMatchObject({ role: "user", content: `${content}\n\nCurrent assignment [user-msg-1]` });
    expect(messages.filter(message => String(message.content).endsWith("Current assignment [user-msg-1]"))).toHaveLength(1);
    expect(messages.find(message => String(message.content).includes("Check the earlier approval."))?.content)
      .toContain("Earlier user message (context only)");
    expect(prompt).toContain("The user message marked Current assignment [user-msg-1] is the current assignment");
    expect(prompt).toContain("do not infer that earlier work completed or resumed");
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it.each([true, false])("fences a retained special command's mutations and response together (%s)", async canceled => {
    const run = retainedTurn();
    mockPrisma.agentMessage.findFirst.mockResolvedValue({ id: "user-msg-1", role: "user", content: "re-enable", taskRunId: "run-123", createdAt: new Date() });
    mockPrisma.modelProvider.findFirst.mockImplementation(async () => {
      if (canceled) run.status = "canceled";
      return { providerId: "fixture-provider", name: "Fixture provider" };
    });
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.scheduledJob.deleteMany.mockResolvedValue({ count: 0 });
    let failure: unknown;
    await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content: "re-enable", routeContext: "/admin", acceptedUserMessageId: "user-msg-1" })).catch(error => { failure = error; });
    expect(mockPrisma.modelProvider.update).toHaveBeenCalledTimes(canceled ? 0 : 1);
    expect(mockPrisma.scheduledJob.deleteMany).toHaveBeenCalledTimes(canceled ? 0 : 1);
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledTimes(canceled ? 0 : 1);
    expect(run.status).toBe(canceled ? "canceled" : "completed");
    if (!canceled) expect(failure).toBeUndefined();
  });

  it("keeps the accepted assignment identifiable after a real loop tool-failure hint is appended", async () => {
    retainedTurn();
    vi.mocked(getAvailableTools).mockResolvedValue([{ name: "read_fixture", description: "Read synthetic fixture",
      inputSchema: {}, requiredCapability: "view_platform", executionMode: "immediate", sideEffect: false }] as never);
    vi.mocked(governedExecuteTool).mockResolvedValueOnce({ success: false, error: "fixture_read_failed", message: "Synthetic read failed" } as never);
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce({ content: "", providerId: "ollama-local", modelId: "fixture", inputTokens: 1, outputTokens: 1,
        toolCalls: [{ id: "read-1", name: "read_fixture", arguments: {} }] } as never)
      .mockResolvedValueOnce({ content: "The synthetic read failed; its outcome remains unknown.", providerId: "ollama-local", modelId: "fixture", inputTokens: 1, outputTokens: 1 } as never);

    await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content: "Share it", routeContext: "/admin", acceptedUserMessageId: "user-msg-1" }));

    expect(routeAndCall).toHaveBeenCalledTimes(2);
    const [messages, prompt] = vi.mocked(routeAndCall).mock.calls[1]!;
    expect(messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("Session tool notes") });
    expect(messages.filter(message => String(message.content).endsWith("Current assignment [user-msg-1]")))
      .toEqual([{ role: "user", content: "Share it\n\nCurrent assignment [user-msg-1]" }]);
    expect(prompt).toContain("The user message marked Current assignment [user-msg-1] is the current assignment");
    expect(prompt).toContain("Later tool results and platform nudges do not replace it");
  });

  it("preserves a setup welcome's no-tool-nudge behavior through current-assignment assembly", async () => {
    retainedTurn();
    const content = "[Setup step: welcome] Brief text-only welcome. No tool calls.";
    mockPrisma.agentMessage.findFirst.mockResolvedValue({ id: "user-msg-1", role: "user", content, taskRunId: "run-123", createdAt: new Date() });
    vi.mocked(getAvailableTools).mockResolvedValue([{ name: "read_fixture", description: "Read synthetic fixture",
      inputSchema: {}, requiredCapability: "view_platform", executionMode: "immediate", sideEffect: false }] as never);
    vi.mocked(toolsToOpenAIFormat).mockReturnValue([{ type: "function", function: { name: "read_fixture", description: "Read fixture", parameters: {} } }] as never);
    vi.mocked(routeAndCall).mockResolvedValue({ content: "Welcome!", providerId: "anthropic", modelId: "fixture", inputTokens: 1, outputTokens: 1 } as never);

    await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content, routeContext: "/admin", acceptedUserMessageId: "user-msg-1" }));

    expect(routeAndCall).toHaveBeenCalledOnce();
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it.each([true, false])("publishes the real production response only when cancellation has not won (%s)", async (canceled) => {
    const run = retainedTurn();
    vi.mocked(routeAndCall).mockImplementationOnce(async () => {
      if (canceled) run.status = "canceled";
      return { content: "A response that arrived after cancellation", providerId: "ollama-local", modelId: "fixture",
        inputTokens: 1, outputTokens: 1, downgraded: false, downgradeMessage: null, routeDecision: {} } as never;
    });

    let failure: unknown;
    await withForegroundWork("run-123", () => sendMessage({ threadId: "thread-1", content: "Share it", routeContext: "/admin", acceptedUserMessageId: "user-msg-1" })).catch(error => { failure = error; });
    expect(routeAndCall).toHaveBeenCalledOnce();
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    const writes = mockPrisma.agentMessage.create.mock.calls.filter(([arg]: any[]) => arg.data.role === "assistant");
    expect(writes).toHaveLength(canceled ? 0 : 1);
    if (canceled) expect(failure).toBeInstanceOf(Error);
    else {
      expect(failure).toBeUndefined();
      expect(run.status).toBe("completed");
      expect((run.progressPayload as any).resultMessageId).toBe(writes[0][0].data.id);
      expect((await import("@/lib/semantic-memory")).storeConversationMemory).not.toHaveBeenCalled();
      expect((await import("@/lib/process-observer-hook")).observeConversation).not.toHaveBeenCalled();
    }
  });
});
