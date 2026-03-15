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

vi.mock("@/lib/ai-provider-priority", () => ({
  callWithFailover: vi.fn(),
  NoAllowedProvidersForSensitivityError: class extends Error {},
  NoProvidersAvailableError: class extends Error {},
}));

vi.mock("@/lib/ai-inference", () => ({
  logTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/mcp-tools", () => ({
  getAvailableTools: vi.fn(),
  toolsToOpenAIFormat: vi.fn(),
  executeTool: vi.fn(),
}));

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
  },
}));

import { auth } from "@/lib/auth";
import { resolveAgentForRoute } from "@/lib/agent-routing";
import { callWithFailover } from "@/lib/ai-provider-priority";
import { executeTool, getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { prisma } from "@dpf/db";
import { sendMessage } from "./agent-coworker";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAgentForRoute = resolveAgentForRoute as ReturnType<typeof vi.fn>;
const mockCallWithFailover = callWithFailover as ReturnType<typeof vi.fn>;
const mockGetAvailableTools = getAvailableTools as ReturnType<typeof vi.fn>;
const mockToolsToOpenAIFormat = toolsToOpenAIFormat as ReturnType<typeof vi.fn>;
const mockExecuteTool = executeTool as ReturnType<typeof vi.fn>;
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
    mockResolveAgentForRoute.mockReturnValue({
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
  });

  it("passes external access state into available tool filtering", async () => {
    mockGetAvailableTools.mockReturnValue([]);
    mockCallWithFailover.mockResolvedValue({
      content: "No tools used.",
      providerId: "ollama-local",
      inputTokens: 1,
      outputTokens: 1,
      inferenceMs: 10,
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
      { externalAccessEnabled: true },
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
    mockCallWithFailover.mockResolvedValue({
      content: "",
      providerId: "ollama-local",
      inputTokens: 1,
      outputTokens: 1,
      inferenceMs: 10,
      toolCalls: [
        {
          name: "analyze_public_website_branding",
          arguments: {
            url: "https://jackjackspack.org",
          },
        },
      ],
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
      { routeContext: "/admin" },
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
});
