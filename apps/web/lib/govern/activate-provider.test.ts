import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAutoDiscoverAndProfile } = vi.hoisted(() => ({
  mockPrisma: {
    modelProvider: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    modelProfile: {
      updateMany: vi.fn(),
    },
    mcpServer: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  mockAutoDiscoverAndProfile: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/ai-provider-internals", () => ({
  autoDiscoverAndProfile: mockAutoDiscoverAndProfile,
}));

import { activateProvider } from "./activate-provider";

describe("activateProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.modelProvider.update.mockResolvedValue({});
    mockPrisma.modelProfile.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);
    mockAutoDiscoverAndProfile.mockResolvedValue({ discovered: 3, profiled: 3 });
  });

  it("sets status to active and derives 3-level clearance for cloud providers", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic-sub",
      category: "direct",
      endpointType: "llm",
      status: "unconfigured",
    });

    const result = await activateProvider("anthropic-sub", { trigger: "test_auth" });

    expect(result.status).toBe("active");
    expect(result.clearance).toEqual(["public", "internal", "confidential"]);
    expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "anthropic-sub" },
      data: {
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential"],
      },
    });
  });

  it("derives 4-level clearance for local providers", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local",
      category: "local",
      endpointType: "ollama",
      status: "unconfigured",
    });

    const result = await activateProvider("local", { trigger: "bootstrap" });

    expect(result.clearance).toEqual(["public", "internal", "confidential", "restricted"]);
    expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "local" },
      data: {
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      },
    });
  });

  it("uses explicit clearance override when provided", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "custom-provider",
      category: "direct",
      endpointType: "llm",
      status: "unconfigured",
    });

    const result = await activateProvider("custom-provider", {
      trigger: "mcp_register",
      sensitivityClearance: ["public"],
    });

    expect(result.clearance).toEqual(["public"]);
  });

  it("sets authMethod when provided", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "codex",
      category: "agent",
      endpointType: "responses",
      status: "unconfigured",
    });

    await activateProvider("codex", {
      trigger: "oauth_exchange",
      authMethod: "oauth2_authorization_code",
    });

    expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "codex" },
      data: {
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential"],
        authMethod: "oauth2_authorization_code",
      },
    });
  });

  it("runs autoDiscoverAndProfile by default", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "gemini",
      category: "direct",
      endpointType: "gemini",
      status: "unconfigured",
    });

    const result = await activateProvider("gemini", { trigger: "test_auth" });

    expect(mockAutoDiscoverAndProfile).toHaveBeenCalledWith("gemini");
    expect(result.discovered).toBe(3);
    expect(result.profiled).toBe(3);
  });

  it("skips discovery when skipDiscovery is true", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "local",
      category: "local",
      endpointType: "ollama",
      status: "unconfigured",
    });

    const result = await activateProvider("local", {
      trigger: "bootstrap",
      skipDiscovery: true,
    });

    expect(mockAutoDiscoverAndProfile).not.toHaveBeenCalled();
    expect(result.discovered).toBe(0);
    expect(result.profiled).toBe(0);
  });

  it("restores runtime-retired models on activation", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "anthropic-sub",
      category: "direct",
      endpointType: "llm",
      status: "disabled",
    });

    await activateProvider("anthropic-sub", { trigger: "test_auth" });

    expect(mockPrisma.modelProfile.updateMany).toHaveBeenCalledWith({
      where: {
        providerId: "anthropic-sub",
        modelStatus: { in: ["degraded", "retired"] },
        retiredReason: { in: ["model_not_found from provider"] },
      },
      data: {
        modelStatus: "active",
        retiredAt: null,
        retiredReason: null,
      },
    });
  });

  it("returns gracefully when provider does not exist", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue(null);

    const result = await activateProvider("nonexistent", { trigger: "seed" });

    expect(result.warning).toContain("not found");
    expect(mockPrisma.modelProvider.update).not.toHaveBeenCalled();
    expect(mockAutoDiscoverAndProfile).not.toHaveBeenCalled();
  });

  it("captures discovery warnings without failing activation", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "gemini",
      category: "direct",
      endpointType: "gemini",
      status: "unconfigured",
    });
    mockAutoDiscoverAndProfile.mockResolvedValue({
      discovered: 0,
      profiled: 0,
      error: "Rate limited by provider",
    });

    const result = await activateProvider("gemini", { trigger: "api_key_configure" });

    // Provider still activated despite discovery warning
    expect(result.status).toBe("active");
    expect(result.warning).toBe("Rate limited by provider");
    expect(mockPrisma.modelProvider.update).toHaveBeenCalled();
  });

  it("activates linked sibling when activateLinked is true", async () => {
    // First call: codex (main provider)
    // Second call: chatgpt (sibling, via activateLinkedSibling)
    mockPrisma.modelProvider.findUnique
      .mockResolvedValueOnce({
        providerId: "codex",
        category: "agent",
        endpointType: "responses",
        status: "unconfigured",
      })
      // sibling lookup
      .mockResolvedValueOnce({
        providerId: "chatgpt",
        category: "subscription",
        endpointType: "responses",
        status: "unconfigured",
      })
      // activateProvider recursive call for chatgpt
      .mockResolvedValueOnce({
        providerId: "chatgpt",
        category: "subscription",
        endpointType: "responses",
        status: "unconfigured",
      });

    await activateProvider("codex", {
      trigger: "oauth_exchange",
      authMethod: "oauth2_authorization_code",
      activateLinked: true,
    });

    // Should have updated both codex and chatgpt
    const updateCalls = mockPrisma.modelProvider.update.mock.calls;
    const updatedProviders = updateCalls.map(
      (call: Array<{ where: { providerId: string } }>) => call[0].where.providerId,
    );
    expect(updatedProviders).toContain("codex");
    expect(updatedProviders).toContain("chatgpt");
  });

  it("does not recurse infinitely on sibling activation", async () => {
    mockPrisma.modelProvider.findUnique.mockResolvedValue({
      providerId: "codex",
      category: "agent",
      endpointType: "responses",
      status: "unconfigured",
    });

    await activateProvider("codex", {
      trigger: "oauth_exchange",
      activateLinked: true,
    });

    // Sibling activation calls activateProvider with activateLinked: false,
    // so update should be called at most twice (codex + chatgpt), not infinitely
    expect(mockPrisma.modelProvider.update.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
