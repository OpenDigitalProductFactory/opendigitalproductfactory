import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findMany: vi.fn(),
    },
    mcpIntegration: {
      findMany: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    taskRequirement: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/actions/built-in-tools", () => ({
  getBuiltInToolsOverview: vi.fn(),
}));

// Keep the REAL grant predicate + expansion (BI-378D3659): readiness must agree
// with the runtime, so only the two data seams are stubbed.
vi.mock("@/lib/tak/agent-grants", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/tak/agent-grants")>()),
  getAgentToolGrantsAsync: vi.fn(),
  getToolGrantMapping: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { getAgentToolGrantsAsync, getToolGrantMapping } from "@/lib/tak/agent-grants";
import { getToolMarketplaceReadiness } from "./tool-marketplace-readiness";

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(getAgentToolGrantsAsync).mockResolvedValue(["registry_read"]);
  vi.mocked(getToolGrantMapping).mockReturnValue({
    search_public_web: ["web_search"],
    fetch_public_website: ["web_search"],
  });

  vi.mocked(prisma.integrationCredential.findMany).mockResolvedValue([
    { integrationId: "adp-workforce-now", status: "connected" },
    { integrationId: "quickbooks-online-accounting", status: "connected" },
  ] as never);

  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
    {
      id: "mcp-payroll",
      name: "Payroll MCP",
      shortDescription: "Payroll service catalog",
      category: "hr",
      documentationUrl: "https://example.com/payroll",
      mcpServers: [],
    },
    {
      id: "mcp-github",
      name: "GitHub MCP",
      shortDescription: "Repository automation",
      category: "engineering",
      documentationUrl: "https://example.com/github",
      mcpServers: [
        {
          id: "server-1",
          tools: [{ toolName: "list_pull_requests" }, { toolName: "create_issue" }],
        },
      ],
    },
  ] as never);

  vi.mocked(getBuiltInToolsOverview).mockResolvedValue({
    tools: [
      {
        id: "brave-search",
        name: "Brave Search",
        description: "Public web search",
        model: "built-in",
        configKey: "brave_search_api_key",
        configured: true,
        capability: "search_public_web",
      },
      {
        id: "public-web-fetch",
        name: "Public Web Fetch",
        description: "Fetch public websites",
        model: "built-in",
        configKey: null,
        configured: true,
        capability: "fetch_public_website",
      },
    ],
    keyData: {
      brave_search_api_key: { configured: true, currentValue: "configured" },
    },
    addressValidation: {
      commercialProviderDetected: false,
      siteLookupReady: false,
      headline: "No address validation provider is configured.",
      nextStep: "Choose Smarty or Mapbox.",
      primaryCountry: null,
    },
  });

  vi.mocked(prisma.taskRequirement.findUnique).mockImplementation((input) => Promise.resolve({
    taskType: input.where.taskType,
    description: `${input.where.taskType} task`,
  }) as never);

  vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([
    {
      providerId: "anthropic",
      name: "Anthropic",
      modelProfiles: [
        {
          modelId: "claude-sonnet-4-6",
          friendlyName: "Claude Sonnet 4.6",
        },
      ],
    },
  ] as never);
});

describe("getToolMarketplaceReadiness", () => {
  it("summarizes configured, unconfigured, ungranted, and model-readiness states", async () => {
    const result = await getToolMarketplaceReadiness({ agentId: "coo" });

    expect(result.summary).toMatchObject({
      total: 21,
      ready: 3,
      available: 1,
      needsSetup: 14,
      needsGrant: 3,
      blocked: 0,
    });
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mcp-payroll",
          readiness: "available",
          missingSetup: ["Activate MCP service"],
        }),
        expect.objectContaining({
          id: "adp",
          readiness: "needs_grant",
          missingGrants: ["consumer_read"],
        }),
        expect.objectContaining({
          id: "quickbooks",
          readiness: "ready",
        }),
        expect.objectContaining({
          id: "facebook-pages",
          readiness: "needs_setup",
        }),
        expect.objectContaining({
          id: "google-business-profile",
          readiness: "needs_setup",
        }),
        expect.objectContaining({
          id: "brave-search",
          readiness: "needs_grant",
          missingGrants: ["web_search"],
        }),
        expect.objectContaining({
          id: "build-studio-frontier-tool-model",
          readiness: "ready",
        }),
      ]),
    );
  });

  it("blocks Build Studio guidance when no frontier tool-capable model is active", async () => {
    vi.mocked(prisma.modelProvider.findMany).mockResolvedValue([] as never);

    const result = await getToolMarketplaceReadiness({
      query: "Build Studio",
      includeKinds: ["model_requirement"],
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "build-studio-frontier-tool-model",
        readiness: "blocked",
        missingSetup: ["Activate a frontier, tool-capable model provider"],
      }),
    ]);
    expect(result.summary).toMatchObject({ total: 1, blocked: 1 });
  });

  // BI-378D3659: a tool's required grants are ALTERNATIVES at runtime (any one,
  // after GRANT_IMPLICATIONS expansion). Readiness demanded every one and never
  // expanded, so it reported "needs grant" for tools the coworker could call.
  describe("grant readiness matches the runtime predicate", () => {
    const builtIn = (capability: string) => ({
      id: capability, name: capability, description: capability, model: "built-in",
      configKey: null, configured: true, capability,
    });
    async function readinessFor(required: string[], held: string[]) {
      vi.mocked(getAgentToolGrantsAsync).mockResolvedValue(held);
      vi.mocked(getToolGrantMapping).mockReturnValue({ probe_tool: required });
      vi.mocked(getBuiltInToolsOverview).mockResolvedValue({
        tools: [builtIn("probe_tool")],
      } as never);
      const result = await getToolMarketplaceReadiness({ agentId: "coo", includeKinds: ["built_in"] });
      return result.entries[0];
    }

    it("is ready when the coworker holds either alternative", async () => {
      expect(await readinessFor(["web_search", "registry_read"], ["registry_read"]))
        .toMatchObject({ readiness: "ready", missingGrants: [] });
      expect(await readinessFor(["web_search", "registry_read"], ["web_search"]))
        .toMatchObject({ readiness: "ready", missingGrants: [] });
    });

    it("is ready when the coworker holds both alternatives", async () => {
      expect(await readinessFor(["web_search", "registry_read"], ["web_search", "registry_read"]))
        .toMatchObject({ readiness: "ready", missingGrants: [] });
    });

    it("names every alternative when the coworker holds neither", async () => {
      expect(await readinessFor(["web_search", "registry_read"], ["file_read"]))
        .toMatchObject({ readiness: "needs_grant", missingGrants: ["web_search", "registry_read"] });
    });

    it("honours a grant implied through expansion", async () => {
      expect(await readinessFor(["build_evidence"], ["backlog_write"]))
        .toMatchObject({ readiness: "ready", missingGrants: [] });
    });
  });
});
