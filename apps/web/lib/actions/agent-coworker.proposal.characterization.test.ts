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

const mockPrisma = prisma as any;

beforeEach(() => {
  setRoomAuthority({});
  vi.clearAllMocks();
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
