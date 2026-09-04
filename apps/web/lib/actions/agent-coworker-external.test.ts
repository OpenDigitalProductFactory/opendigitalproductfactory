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
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { routeAndCall } from "@/lib/routed-inference";
import { classifyTask } from "@/lib/task-classifier";
import { executeTool, getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import { assembleSystemPromptWithProvenance } from "@/lib/prompt-assembler";
import { createTaskArtifact } from "@/lib/tak/task-records";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import { prisma } from "@dpf/db";
import { sendMessage } from "./agent-coworker";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockIsUnifiedCoworkerEnabled = isUnifiedCoworkerEnabled as ReturnType<typeof vi.fn>;
const mockResolveAgentForRoute = resolveAgentForRouteWithPrompts as ReturnType<typeof vi.fn>;
const mockRouteAndCall = routeAndCall as ReturnType<typeof vi.fn>;
const mockClassifyTask = classifyTask as ReturnType<typeof vi.fn>;
const mockGetAvailableTools = getAvailableTools as ReturnType<typeof vi.fn>;
const mockToolsToOpenAIFormat = toolsToOpenAIFormat as ReturnType<typeof vi.fn>;
const mockExecuteTool = executeTool as ReturnType<typeof vi.fn>;
const mockGovernedExecuteTool = governedExecuteTool as ReturnType<typeof vi.fn>;
const mockResolvePortalContextEnvelope = resolvePortalContextEnvelope as ReturnType<typeof vi.fn>;
const mockAssembleSystemPrompt = assembleSystemPromptWithProvenance as ReturnType<typeof vi.fn>;
const mockCreateTaskArtifact = createTaskArtifact as ReturnType<typeof vi.fn>;
const mockRecordWorkCapsuleEvidence = recordWorkCapsuleEvidence as ReturnType<typeof vi.fn>;
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
    mockPrisma.organization.findFirst.mockResolvedValue(null);
    mockPrisma.taskRun.findFirst.mockResolvedValue(null);
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      buildId: "FB-123",
      phase: "implement",
      threadId: "thread-1",
      buildExecState: null,
      verificationOut: null,
      taskResults: null,
    });
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
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ id: "backlog-row-1" });
    mockPrisma.backlogItemActivity.create.mockResolvedValue({ id: "backlog-activity-1" });
    mockCreateTaskArtifact.mockResolvedValue({ id: "artifact-row-1", artifactId: "ta_123" });
    mockRecordWorkCapsuleEvidence.mockResolvedValue({ id: "activity-1" });
    mockResolvePortalContextEnvelope.mockResolvedValue({
      promptDigest: "Route: /build\nBuild: FB-123 phase=implement status=active\nCapsule: WC-123 status=claimed executor=codex",
      anchors: [
        { kind: "build", id: "FB-123", label: "Portal context build", href: "/build?buildId=FB-123" },
        { kind: "capsule", id: "WC-123", label: "Portal context capsule", href: "/build/work/WC-123" },
      ],
      work: {
        capsule: { capsuleId: "WC-123" },
      },
    });
    mockClassifyTask.mockReturnValue({
      taskType: "conversation",
      confidence: 0.8,
      requiresCodeExecution: false,
      requiresWebSearch: false,
      requiresComputerUse: false,
    });
    mockGovernedExecuteTool.mockImplementation(async () => {
      return {
        success: true,
        message: "Derived branding suggestions for Jack Jack's Pack.",
        data: {
          companyName: "Jack Jack's Pack",
          logoUrl: "https://jackjackspack.org/logo.svg",
          paletteAccent: "#4f46e5",
        },
      };
    });
    mockPrisma.agentMessage.create
      .mockResolvedValueOnce({
        id: "user-msg-1",
        role: "user",
        content: "Analyze this site",
        agentId: null,
        routeContext: "/admin",
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: "agent-msg-1",
        role: "assistant",
        content: "Derived branding suggestions for Jack Jack's Pack.",
        agentId: "admin-assistant",
        routeContext: "/admin",
        createdAt: new Date("2026-03-14T00:00:01.000Z"),
      });
    mockToolsToOpenAIFormat.mockReturnValue([]);
    mockIsUnifiedCoworkerEnabled.mockResolvedValue(false);
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

  it("passes question packet context into unified prompt assembly", async () => {
    mockIsUnifiedCoworkerEnabled.mockResolvedValueOnce(true);
    mockGetAvailableTools.mockReturnValue([]);
    mockRouteAndCall.mockResolvedValue({
      content: "Use the smallest safe slice.",
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
      content: "Continue the implementation plan",
      routeContext: "/workspace",
      questionPacket: {
        intentCenter: "Improve the coworker prompt envelope.",
        hardEdges: ["Do not grant extra tool authority."],
        expectedArtifact: "patch",
      },
    });

    expect(mockAssembleSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        questionPacket: {
          intentCenter: "Improve the coworker prompt envelope.",
          hardEdges: ["Do not grant extra tool authority."],
          expectedArtifact: "patch",
        },
        // BI-463BE12A: declared brief; undeclared text counts as the turn's data.
        instructionSpans: expect.arrayContaining([expect.any(String)]),
      }),
    );
  });

  it("strips coworker tools for natural page explanation requests", async () => {
    mockGetAvailableTools.mockReturnValue([
      {
        name: "create_backlog_item",
        description: "Create backlog item",
        inputSchema: {},
        requiredCapability: "manage_backlog",
        sideEffect: true,
      },
      {
        name: "query_backlog",
        description: "Query backlog",
        inputSchema: {},
        requiredCapability: "view_platform",
        executionMode: "immediate",
        sideEffect: false,
      },
    ]);
    mockRouteAndCall.mockResolvedValue({
      content: "This workspace is your operating dashboard: it brings queue, schedule, and cross-platform activity together so you can decide what needs attention next.",
      providerId: "openai",
      modelId: "gpt",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      toolsStripped: false,
      routeDecision: {},
    });

    await sendMessage({
      threadId: "thread-1",
      content: "I'm finding this user interface a little bit confusing. Can you explain it for me?",
      routeContext: "/workspace",
      coworkerMode: "act",
    });

    expect(mockToolsToOpenAIFormat).not.toHaveBeenCalled();
    expect(mockRouteAndCall).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining("READ-ONLY PAGE EXPLANATION REQUEST"),
      "restricted",
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  // BI-463BE12A. USE_UNIFIED_COWORKER is off on a default install, so this is
  // the path that decides whether a COO or HR coworker reaches a cloud provider.
  it("declares the coworker's brief as instruction on the legacy path", async () => {
    await sendMessage({
      threadId: "thread-1",
      content: "What needs my attention?",
      routeContext: "/workspace",
      coworkerMode: "act",
    });

    const options = mockRouteAndCall.mock.calls[0]?.[3] ?? {};
    expect(options.systemPromptInstructionSpans).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    // Page context is DATA and must stay undeclared.
    const declared = (options.systemPromptInstructionSpans ?? []).join("\n");
    expect(declared).not.toContain("PAGE DATA");
  });

  it("strips coworker tools for terse explanation follow-ups like elaborate", async () => {
    mockGetAvailableTools.mockReturnValue([
      {
        name: "create_backlog_item",
        description: "Create backlog item",
        inputSchema: {},
        requiredCapability: "manage_backlog",
        sideEffect: true,
      },
      {
        name: "query_backlog",
        description: "Query backlog",
        inputSchema: {},
        requiredCapability: "view_platform",
        executionMode: "immediate",
        sideEffect: false,
      },
    ]);
    mockRouteAndCall.mockResolvedValue({
      content: "More detail: Mark treats portal bugs as trust issues because silent failures damage confidence.",
      providerId: "openai",
      modelId: "gpt",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      toolsStripped: false,
      routeDecision: {},
    });

    await sendMessage({
      threadId: "thread-1",
      content: "elaborate",
      routeContext: "/coworker-decisions/perspectives/mark-dpf-platform/voice",
      coworkerMode: "act",
    });

    expect(mockToolsToOpenAIFormat).not.toHaveBeenCalled();
    expect(mockRouteAndCall).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining("READ-ONLY FOLLOW-UP REQUEST"),
      "restricted",
      expect.not.objectContaining({ tools: expect.anything() }),
    );
  });

  it("injects portal context digest and stable anchors into supported route prompts", async () => {
    mockGetAvailableTools.mockReturnValue([]);
    mockRouteAndCall.mockResolvedValue({
      content: "I can see the anchored Build Studio context.",
      providerId: "ollama-local",
      modelId: "llama3.1",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      routeDecision: {},
    });
    mockResolvePortalContextEnvelope.mockResolvedValueOnce({
      promptDigest: [
        "Route: /build",
        "Build: FB-123 phase=implement status=active",
        "Capsule: WC-123 status=claimed executor=codex",
      ].join("\n"),
      anchors: [
        { kind: "build", id: "FB-123", label: "Portal context build", href: "/build?buildId=FB-123" },
        { kind: "capsule", id: "WC-123", label: "Portal context capsule", href: "/build/work/WC-123" },
      ],
      rawPayload: "TOKEN=abc123",
    });

    await sendMessage({
      threadId: "thread-1",
      content: "What should happen next?",
      routeContext: "/build",
      buildId: "FB-123",
    });

    expect(mockResolvePortalContextEnvelope).toHaveBeenCalledWith(
      {
        pathname: "/build",
        routeContext: "/build",
        buildId: "FB-123",
        threadId: "thread-1",
      },
      "user-1",
    );
    const prompt = String(mockRouteAndCall.mock.calls[0]?.[1] ?? "");
    expect(prompt).toContain("--- PORTAL CONTEXT ---");
    expect(prompt).toContain("Build: FB-123 phase=implement status=active");
    expect(prompt).toContain("Anchors: build:FB-123, capsule:WC-123");
    expect(prompt).not.toContain("TOKEN=abc123");
  });

  it("adds shared External Access request guidance and audit when web tools are withheld", async () => {
    mockClassifyTask.mockReturnValue({
      taskType: "web-search",
      confidence: 0.8,
      requiresWebSearch: true,
      requiresCodeExecution: false,
      requiresComputerUse: false,
    });
    mockGetAvailableTools.mockImplementation((_userContext, options) =>
      options?.externalAccessEnabled
        ? [
            {
              name: "search_public_web",
              description: "Search the public web",
              inputSchema: {},
              requiredCapability: null,
              requiresExternalAccess: true,
              executionMode: "immediate",
              sideEffect: false,
            },
            {
              name: "fetch_public_website",
              description: "Fetch a public website",
              inputSchema: {},
              requiredCapability: null,
              requiresExternalAccess: true,
              executionMode: "immediate",
              sideEffect: false,
            },
          ]
        : [],
    );
    mockRouteAndCall.mockResolvedValue({
      content: "External Access is off. Enable it so I can verify official sources.",
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
      content: "Look up current sales tax authority guidance.",
      routeContext: "/finance",
      externalAccessEnabled: false,
    });

    expect(mockRouteAndCall.mock.calls[0][1]).toContain("EXTERNAL ACCESS DISABLED");
    expect(mockRouteAndCall.mock.calls[0][1]).toContain("search_public_web");
    expect(mockRouteAndCall.mock.calls[0][1]).toContain("Web access");
    expect(mockRouteAndCall.mock.calls[0][1]).toContain("message box");
    expect(mockPrisma.toolExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: "external_access_permission_request",
          executionMode: "permission",
          routeContext: "/finance",
          success: true,
          parameters: expect.objectContaining({
            requestedTools: ["search_public_web", "fetch_public_website"],
          }),
        }),
      }),
    );
  });

  it("audits External Access approval when a web task continues with access enabled", async () => {
    mockClassifyTask.mockReturnValue({
      taskType: "web-search",
      confidence: 0.8,
      requiresWebSearch: true,
      requiresCodeExecution: false,
      requiresComputerUse: false,
    });
    mockGetAvailableTools.mockReturnValue([
      {
        name: "search_public_web",
        description: "Search the public web",
        inputSchema: {},
        requiredCapability: null,
        requiresExternalAccess: true,
        executionMode: "immediate",
        sideEffect: false,
      },
    ]);
    mockRouteAndCall.mockResolvedValue({
      content: "I checked official sources.",
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
      content: "External Access is enabled. Continue the tax authority research.",
      routeContext: "/finance",
      externalAccessEnabled: true,
    });

    expect(mockPrisma.toolExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: "external_access_permission_approval",
          executionMode: "permission",
          routeContext: "/finance",
          success: true,
          parameters: expect.objectContaining({
            requestedTools: ["search_public_web"],
          }),
        }),
      }),
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

    expect(mockGovernedExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "analyze_public_website_branding",
        rawParams: { url: "https://jackjackspack.org" },
        userId: "user-1",
        source: "agentic-loop",
        context: expect.objectContaining({ routeContext: "/admin" }),
      }),
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
    mockPrisma.taskRun.findFirst.mockResolvedValue({ taskRunId: "run-123" });
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

  it("persists substantive coworker responses as TaskArtifact and Work Capsule evidence", async () => {
    mockPrisma.taskRun.findFirst.mockResolvedValue({ taskRunId: "run-123" });
    mockGetAvailableTools.mockReturnValue([]);
    mockRouteAndCall.mockResolvedValue({
      content: "I reviewed the anchored capsule and recommend finishing the evidence handoff before promotion.",
      providerId: "ollama-local",
      modelId: "llama3.1",
      inputTokens: 1,
      outputTokens: 1,
      toolCalls: [],
      downgraded: false,
      downgradeMessage: null,
      routeDecision: {},
    });
    mockResolvePortalContextEnvelope.mockResolvedValueOnce({
      envelopeId: "env-1",
      promptDigest: "Route: /build\nBuild: FB-123 phase=implement status=active\nCapsule: WC-123 status=claimed executor=codex",
      anchors: [
        { kind: "build", id: "FB-123", label: "Portal context build", href: "/build?buildId=FB-123" },
        { kind: "capsule", id: "WC-123", label: "Portal context capsule", href: "/build/work/WC-123" },
        { kind: "backlogItem", id: "BI-123", label: "Portal context backlog", href: "/ops/backlog/BI-123" },
      ],
      work: {
        capsule: { capsuleId: "WC-123" },
        backlogItem: { backlogItemId: "BI-123" },
      },
    });

    await sendMessage({
      threadId: "thread-1",
      content: "What should happen next?",
      routeContext: "/build",
      buildId: "FB-123",
    });

    expect(mockCreateTaskArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        taskRunId: "run-123",
        artifactType: "coworker_response",
        name: "Coworker response",
        producerAgentId: "admin-assistant",
      }),
    );
    expect(mockRecordWorkCapsuleEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        capsuleId: "WC-123",
        evidence: expect.objectContaining({
          kind: "note",
          summary: "Admin Assistant response captured for the current portal context.",
        }),
      }),
    );
    expect(mockPrisma.backlogItemActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          backlogItemId: "backlog-row-1",
          kind: "portal-context-coworker-response",
          summary: "Admin Assistant response captured for the current portal context.",
          recordedById: "user-1",
          recordedByAgentId: "admin-assistant",
        }),
      }),
    );
  });
});
