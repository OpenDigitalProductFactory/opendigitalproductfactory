// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S1,
// chat persistence. What sendMessage writes TODAY when the loop returns a
// proposal-mode call (agent-coworker.ts, the `agenticResult.proposal` branch):
// one assistant message at the pre-allocated id, one `AP-` AgentActionProposal
// linked to it, and the serialized message carries the proposal for the
// inline card. PR-B changes exactly this (named delta: the proposal row becomes
// an envelope list); the loop-level cases live in
// lib/tak/agentic-loop.proposal-mode.characterization.test.ts.
//
// The mock harness mirrors agent-coworker-external.test.ts (vitest mock
// harnesses are per-file; that file is at the module-size ceiling).
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    user: {
      findUnique: vi.fn(),
    },
    agentThread: {
      findUnique: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
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
    },
    taskRun: {
      findFirst: vi.fn(),
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

const mockPrisma = prisma as any;

beforeEach(() => {
  setRoomAuthority({});
  vi.clearAllMocks();
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

describe("S1 — chat persists a proposal-mode call as an AP- proposal (characterisation)", () => {
  it("writes the assistant message at the pre-allocated id and an AP- proposal linked to it", async () => {
    const result = await sendMessage({ threadId: "thread-1", content: "Share it", routeContext: "/admin" });

    expect(governedExecuteTool).not.toHaveBeenCalled();
    const messageWrite = mockPrisma.agentMessage.create.mock.calls[1][0].data;
    expect(messageWrite).toMatchObject({
      threadId: "thread-1", role: "assistant", taskRunId: "run-123",
      content: "I'd like to share this finding.", agentId: "admin-assistant", routeContext: "/admin",
    });
    expect(typeof messageWrite.id).toBe("string");

    expect(mockPrisma.agentActionProposal.create).toHaveBeenCalledTimes(1);
    const proposalWrite = mockPrisma.agentActionProposal.create.mock.calls[0][0].data;
    expect(proposalWrite).toEqual({
      proposalId: expect.stringMatching(/^AP-[A-Z0-9]{1,5}$/),
      threadId: "thread-1",
      messageId: messageWrite.id,
      taskRunId: "run-123",
      agentId: "admin-assistant",
      actionType: "contribute_to_hive",
      parameters: { title: "Finding", body: "Details" },
      status: "proposed",
    });

    expect("agentMessage" in result && result.agentMessage).toMatchObject({
      id: messageWrite.id,
      role: "assistant",
      proposal: {
        proposalId: proposalWrite.proposalId,
        actionType: "contribute_to_hive",
        parameters: { title: "Finding", body: "Details" },
        status: "proposed",
      },
    });
  });
});
