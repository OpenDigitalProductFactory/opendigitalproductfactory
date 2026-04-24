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

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedCoworkerEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/route-context", () => ({
  getRouteDataContext: vi.fn().mockResolvedValue(null),
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

vi.mock("@/lib/tak/task-chat-projection", () => ({
  ensureTaskForCoworkerTurn: vi.fn(),
  projectThreadMessageToTask: vi.fn().mockResolvedValue(undefined),
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
    modelProvider: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    taskRun: {
      findFirst: vi.fn(),
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
  },
}));

import { auth } from "@/lib/auth";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { routeAndCall } from "@/lib/routed-inference";
import { executeTool, getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import {
  ensureTaskForCoworkerTurn,
  projectThreadMessageToTask,
} from "@/lib/tak/task-chat-projection";
import { prisma } from "@dpf/db";
import { recordAgentTransition, sendMessage } from "./agent-coworker";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAgentForRoute = resolveAgentForRouteWithPrompts as ReturnType<typeof vi.fn>;
const mockRouteAndCall = routeAndCall as ReturnType<typeof vi.fn>;
const mockGetAvailableTools = getAvailableTools as ReturnType<typeof vi.fn>;
const mockToolsToOpenAIFormat = toolsToOpenAIFormat as ReturnType<typeof vi.fn>;
const mockExecuteTool = executeTool as ReturnType<typeof vi.fn>;
const mockEnsureTaskForCoworkerTurn = ensureTaskForCoworkerTurn as ReturnType<typeof vi.fn>;
const mockProjectThreadMessageToTask = projectThreadMessageToTask as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as any;

describe("agent coworker external access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-000",
        isSuperuser: false,
      },
    });
    mockResolveAgentForRoute.mockResolvedValue({
      agentId: "admin-assistant",
      agentName: "Admin Assistant",
      agentDescription: "Admin help",
      canAssist: true,
      sensitivity: "restricted",
      systemPrompt: "Prompt",
      skills: [],
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.agentThread.findUnique.mockResolvedValue({ id: "thread-1", userId: "user-1" });
    mockPrisma.agentMessage.findMany.mockResolvedValue([]);
    mockPrisma.agentAttachment.findMany.mockResolvedValue([]);
    mockPrisma.agent.findUnique.mockResolvedValue(null);
    mockPrisma.taskRun.findFirst.mockResolvedValue(null);
    mockEnsureTaskForCoworkerTurn.mockResolvedValue({
      id: "task-row-1",
      taskRunId: "run-123",
      contextId: "thread-1",
    });
    mockProjectThreadMessageToTask.mockResolvedValue(undefined);
    mockPrisma.agentActionProposal.create.mockResolvedValue({
      proposalId: "AP-TRACE",
      actionType: "create_backlog_item",
      parameters: {},
      status: "proposed",
      resultEntityId: null,
      resultError: null,
    });
    mockPrisma.agentModelConfig.findUnique.mockResolvedValue(null);
    mockPrisma.toolExecution.create.mockResolvedValue({});
    let messageCount = 0;
    mockPrisma.agentMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      messageCount += 1;
      return {
        id: `${String(data.role ?? "message")}-msg-${messageCount}`,
        role: data.role,
        content: data.content,
        agentId: data.agentId ?? null,
        routeContext: data.routeContext ?? null,
        createdAt: new Date(`2026-03-14T00:00:0${messageCount}.000Z`),
      };
    });
    mockToolsToOpenAIFormat.mockReturnValue([]);
  });

  it("passes external access state into available tool filtering", async () => {
    mockGetAvailableTools.mockReturnValue([]);
    mockRouteAndCall.mockResolvedValue({
      content: "No tools used.",
      providerId: "ollama-local",
      modelId: "llama3.1",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      routeDecision: {},
    });

    await sendMessage({
      threadId: "thread-1",
      content: "Analyze this site",
      routeContext: "/admin",
      externalAccessEnabled: true,
    });

    expect(mockGetAvailableTools).toHaveBeenCalledWith(
      {
        platformRole: "HR-000",
        isSuperuser: false,
      },
      expect.objectContaining({ externalAccessEnabled: true }),
    );
  });

  it("projects coworker chat turns onto the canonical task message stream", async () => {
    mockGetAvailableTools.mockReturnValue([]);
    mockRouteAndCall.mockResolvedValue({
      content: "This is a substantive assistant reply for task projection testing.",
      providerId: "ollama-local",
      modelId: "llama3.1",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      routeDecision: {},
    });

    await sendMessage({
      threadId: "thread-1",
      content: "Analyze this site",
      routeContext: "/admin",
    });

    expect(mockEnsureTaskForCoworkerTurn).toHaveBeenCalled();
    expect(mockEnsureTaskForCoworkerTurn.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            userId: "user-1",
            threadId: "thread-1",
            routeContext: "/admin",
            content: "Analyze this site",
          }),
        ],
      ]),
    );
    expect(mockProjectThreadMessageToTask).toHaveBeenCalledTimes(2);
    expect(mockProjectThreadMessageToTask.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            task: expect.objectContaining({ taskRunId: "run-123" }),
            role: "user",
            content: "Analyze this site",
          }),
        ],
        [
          expect.objectContaining({
            task: expect.objectContaining({ taskRunId: "run-123" }),
            role: "assistant",
            content: "This is a substantive assistant reply for task projection testing.",
            providerId: "ollama-local",
          }),
        ],
      ]),
    );
    expect(mockPrisma.agentMessage.create.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            data: expect.objectContaining({
              taskRunId: "run-123",
            }),
          }),
        ],
      ]),
    );
  });

  it("executes read-only branding analysis tools immediately", async () => {
    mockGetAvailableTools.mockReturnValue([
      {
        name: "analyze_public_website_branding",
        description: "Analyze branding",
        inputSchema: {},
        requiredCapability: "manage_branding",
        requiresExternalAccess: true,
        executionMode: "immediate",
      },
    ]);
    mockRouteAndCall
      .mockResolvedValueOnce({
        content: "",
        providerId: "ollama-local",
        modelId: "llama3.1",
        inputTokens: 1,
        outputTokens: 1,
        downgraded: false,
        downgradeMessage: null,
        routeDecision: {},
        toolCalls: [
          {
            id: "mock_id",
            name: "analyze_public_website_branding",
            arguments: {
              url: "https://jackjackspack.org",
            },
          },
        ],
      })
      .mockResolvedValue({
        content: [
          "I've analyzed Jack Jack's Pack and found the following branding details.",
          "```agent-form",
          JSON.stringify({
            fieldUpdates: {
              companyName: "Jack Jack's Pack",
              logoUrl: "https://jackjackspack.org/logo.svg",
              paletteAccent: "#4f46e5",
            },
          }),
          "```",
        ].join("\n"),
        providerId: "ollama-local",
        modelId: "llama3.1",
        inputTokens: 1,
        outputTokens: 1,
        downgraded: false,
        downgradeMessage: null,
        routeDecision: {},
        toolCalls: [],
      });
    mockExecuteTool.mockResolvedValue({
      success: true,
      message: "Derived branding suggestions for Jack Jack's Pack.",
      data: {
        companyName: "Jack Jack's Pack",
        logoUrl: "https://jackjackspack.org/logo.svg",
        paletteAccent: "#4f46e5",
      },
    });

    const result = await sendMessage({
      threadId: "thread-1",
      content: "Analyze this site",
      routeContext: "/admin",
      externalAccessEnabled: true,
      elevatedFormFillEnabled: true,
      formAssistContext: {
        formId: "branding-configurator",
        formName: "Branding configurator",
        fields: [
          { key: "companyName", label: "Company name", type: "text" },
          { key: "logoUrl", label: "Logo URL", type: "text" },
          { key: "paletteAccent", label: "Accent color", type: "text" },
        ],
      },
    });

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "analyze_public_website_branding",
      { url: "https://jackjackspack.org" },
      "user-1",
      expect.objectContaining({ routeContext: "/admin" }),
    );
    expect(result).not.toHaveProperty("error");
    if (!("error" in result)) {
      expect(result.formAssistUpdate).toEqual({
        companyName: "Jack Jack's Pack",
        logoUrl: "https://jackjackspack.org/logo.svg",
        paletteAccent: "#4f46e5",
      });
    }
  });

  it("stamps the current task run on proposals", async () => {
    mockGetAvailableTools.mockReturnValue([
      {
        name: "create_backlog_item",
        description: "Create backlog item",
        inputSchema: {},
        requiredCapability: "manage_backlog",
        executionMode: "proposal",
        sideEffect: true,
      },
    ]);
    mockRouteAndCall.mockResolvedValue({
      content: "I'd like to create a backlog item for this.",
      providerId: "ollama-local",
      modelId: "llama3.1",
      inputTokens: 1,
      outputTokens: 1,
      downgraded: false,
      downgradeMessage: null,
      routeDecision: {},
      toolCalls: [
        {
          id: "proposal_tool",
          name: "create_backlog_item",
          arguments: {
            title: "Follow up on provider setup",
          },
        },
      ],
    });

    await sendMessage({
      threadId: "thread-1",
      content: "Create a follow-up backlog item",
      routeContext: "/admin",
    });

    expect(mockPrisma.agentActionProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskRunId: "run-123",
        }),
      }),
    );
  });

  it("projects agent transition notices onto the canonical task message stream", async () => {
    await recordAgentTransition({
      threadId: "thread-1",
      agentId: "finance-coworker",
      agentName: "Finance Coworker",
      routeContext: "/finance",
    });

    expect(mockEnsureTaskForCoworkerTurn).toHaveBeenCalledWith({
      userId: "user-1",
      threadId: "thread-1",
      routeContext: "/finance",
      content: "Finance Coworker has joined the conversation",
      agentId: "finance-coworker",
    });
    expect(mockProjectThreadMessageToTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({ taskRunId: "run-123" }),
        role: "system",
        content: "Finance Coworker has joined the conversation",
        routeContext: "/finance",
        agentId: "finance-coworker",
        messageType: "status",
      }),
    );
    expect(mockPrisma.agentMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskRunId: "run-123",
        }),
      }),
    );
  });
});
