// apps/web/lib/ai-provider-data.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Use vi.hoisted so mockPrisma is available when vi.mock factory runs
const mockPrisma = vi.hoisted(() => ({
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
} from "./ai-provider-data";

beforeEach(() => { vi.clearAllMocks(); });

describe("getProviderModelSummaries", () => {
  it("aggregates model counts and non-chat classes per provider", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([
      { providerId: "openai", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelClass: "chat", modelStatus: "active" },
      { providerId: "openai", modelClass: "image_gen", modelStatus: "active" },
      { providerId: "openai", modelClass: "embedding", modelStatus: "retired" },
      { providerId: "anthropic", modelClass: "chat", modelStatus: "active" },
      { providerId: "anthropic", modelClass: "reasoning", modelStatus: "active" },
    ]);

    const result = await getProviderModelSummaries();

    expect(result.get("openai")).toEqual({
      totalModels: 4,
      activeModels: 3,
      nonChatClasses: ["image_gen", "embedding"],
    });
    expect(result.get("anthropic")).toEqual({
      totalModels: 2,
      activeModels: 2,
      nonChatClasses: [],
    });
  });

  it("returns empty map when no profiles exist", async () => {
    mockPrisma.modelProfile.findMany.mockResolvedValue([]);
    const result = await getProviderModelSummaries();
    expect(result.size).toBe(0);
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
