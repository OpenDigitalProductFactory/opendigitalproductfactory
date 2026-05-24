// apps/web/lib/ai-provider-data.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Use vi.hoisted so mockPrisma is available when vi.mock factory runs
const mockPrisma = vi.hoisted(() => ({
  tokenUsage: {
    groupBy: vi.fn(),
  },
  modelProvider: {
    findMany: vi.fn(),
  },
  modelProfile: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  executionRecipe: {
    findMany: vi.fn(),
  },
  mcpServer: {
    findMany: vi.fn(),
  },
  mcpServerTool: {
    findMany: vi.fn(),
  },
  asyncInferenceOp: {
    findMany: vi.fn(),
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

// Must mock React cache to be a passthrough (not available in test env)
vi.mock("react", () => ({ cache: (fn: any) => fn }));

import {
  getProviderModelSummaries,
  getRecipesForProvider,
  getActivatedMcpServers,
  getAsyncOperations,
  getTokenSpendByProvider,
} from "./ai-provider-data";

beforeEach(() => { vi.clearAllMocks(); });

describe("getProviderModelSummaries", () => {
  it("aggregates model counts, non-chat classes, and derived tier per provider", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { providerId: "openai", modelId: "gpt-4o", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelId: "gpt-4o-mini", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelId: "dall-e-3", modelClass: "image_gen", modelStatus: "active" },
      { providerId: "openai", modelId: "text-embedding-3", modelClass: "embedding", modelStatus: "retired" },
      { providerId: "anthropic", modelId: "claude-sonnet-4-6", modelClass: "chat", modelStatus: "active" },
      { providerId: "anthropic", modelId: "claude-opus-4-7", modelClass: "reasoning", modelStatus: "active" },
    ]);

    const result = await getProviderModelSummaries();

    expect(result.get("openai")).toEqual({
      totalModels: 4,
      activeModels: 3,
      nonChatClasses: ["image_gen", "embedding"],
      // D25: derived from gpt-4o (strong) over gpt-4o-mini (adequate).
      // image_gen / embedding don't contribute to the chat-tier signal.
      derivedTier: "strong",
    });
    expect(result.get("anthropic")).toEqual({
      totalModels: 2,
      activeModels: 2,
      nonChatClasses: [],
      // D25: derived from claude-opus-4 (frontier) and claude-sonnet-4 (frontier).
      derivedTier: "frontier",
    });
  });

  it("returns empty map when no profiles exist", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    const result = await getProviderModelSummaries();
    expect(result.size).toBe(0);
  });

  it("D25: ignores non-chat models when deriving tier (image_gen doesn't contribute to the chat-tier signal)", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      // Local install with one basic chat model + an image_gen entry. The
      // derived tier reflects only the chat/reasoning models.
      { providerId: "local", modelId: "ai/llama3.2:8b", modelClass: "chat", modelStatus: "active" },
      { providerId: "local", modelId: "stable-diffusion-xl", modelClass: "image_gen", modelStatus: "active" },
    ]);
    const result = await getProviderModelSummaries();
    expect(result.get("local")?.derivedTier).toBe("basic");
  });

  it("D25: derivedTier is null when no chat/reasoning models present", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { providerId: "openai", modelId: "dall-e-3", modelClass: "image_gen", modelStatus: "active" },
    ]);
    const result = await getProviderModelSummaries();
    expect(result.get("openai")?.derivedTier).toBeNull();
  });
});

describe("getRecipesForProvider", () => {
  it("returns recipes sorted by contractFamily asc, version desc", async () => {
    const recipes = [
      { id: "r1", contractFamily: "sync.tool_action", modelId: "m1", executionAdapter: "chat", status: "champion", version: 2, origin: "seed" },
      { id: "r2", contractFamily: "sync.tool_action", modelId: "m1", executionAdapter: "chat", status: "retired", version: 1, origin: "seed" },
    ];
    mockPrisma.executionRecipe.findMany.mockResolvedValue(recipes);

    const result = await getRecipesForProvider("openai");
    expect(result).toHaveLength(2);
    expect(mockPrisma.executionRecipe.findMany).toHaveBeenCalledWith({
      where: { providerId: "openai" },
      orderBy: [{ contractFamily: "asc" }, { version: "desc" }],
    });
  });
});

describe("getActivatedMcpServers", () => {
  it("excludes deactivated servers", async () => {
    mockPrisma.mcpServer.findMany.mockResolvedValue([]);
    await getActivatedMcpServers();
    const call = mockPrisma.mcpServer.findMany.mock.calls[0][0];
    expect(call.where.deactivatedAt).toBeNull();
  });
});

describe("getAsyncOperations", () => {
  it("returns most recent 50 operations", async () => {
    mockPrisma.asyncInferenceOp.findMany.mockResolvedValue([]);
    await getAsyncOperations();
    expect(mockPrisma.asyncInferenceOp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, orderBy: { createdAt: "desc" } }),
    );
  });
});

describe("getTokenSpendByProvider", () => {
  it("keeps blank or unknown provider usage visible with TokenUsage provenance", async () => {
    mockPrisma.tokenUsage.groupBy.mockResolvedValue([
      {
        providerId: "",
        _sum: { inputTokens: 100, outputTokens: 50, costUsd: 0.05 },
      },
      {
        providerId: "missing-provider",
        _sum: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      },
      {
        providerId: "openai",
        _sum: { inputTokens: 200, outputTokens: 100, costUsd: 0.25 },
      },
    ]);
    mockPrisma.modelProvider.findMany.mockResolvedValue([
      { providerId: "openai", name: "OpenAI" },
    ]);

    const result = await getTokenSpendByProvider({ year: 2026, month: 5 });

    expect(result.map((row) => row.providerName)).toEqual([
      "Unknown provider",
      "Unknown provider (missing-provider)",
      "OpenAI",
    ]);
    expect(result.every((row) => row.provenance.sourceTable === "TokenUsage")).toBe(true);
  });
});
