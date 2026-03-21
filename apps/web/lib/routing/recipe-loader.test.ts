import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    executionRecipe: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { loadChampionRecipe } from "./recipe-loader";

describe("loadChampionRecipe", () => {
  beforeEach(() => {
    vi.mocked(prisma.executionRecipe.findFirst).mockReset();
  });

  it("returns champion recipe for matching keys", async () => {
    const mockRecipe = {
      id: "recipe-1",
      providerId: "openai",
      modelId: "gpt-4o",
      contractFamily: "sync.code-gen",
      version: 1,
      status: "champion",
      origin: "seed",
      providerSettings: { max_tokens: 4096 },
      toolPolicy: {},
      responsePolicy: {},
    };
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(
      mockRecipe as any,
    );
    const result = await loadChampionRecipe("openai", "gpt-4o", "sync.code-gen");
    expect(result).toEqual(mockRecipe);
  });

  it("returns null when no recipe exists", async () => {
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(null);
    const result = await loadChampionRecipe("openai", "gpt-4o", "sync.unknown");
    expect(result).toBeNull();
  });

  it("queries with status champion only", async () => {
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(null);
    await loadChampionRecipe("openai", "gpt-4o", "sync.code-gen");
    expect(prisma.executionRecipe.findFirst).toHaveBeenCalledWith({
      where: {
        providerId: "openai",
        modelId: "gpt-4o",
        contractFamily: "sync.code-gen",
        status: "champion",
      },
      orderBy: { version: "desc" },
    });
  });

  it("ignores retired recipes", async () => {
    // The query filters status: "champion" so retired recipes are never returned.
    // Verify the mock returns null when nothing matches (retired records excluded by query).
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(null);
    const result = await loadChampionRecipe(
      "openai",
      "gpt-4o",
      "sync.code-gen",
    );
    expect(result).toBeNull();
    expect(prisma.executionRecipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "champion" }) }),
    );
  });

  it("ignores blocked recipes", async () => {
    // The query filters status: "champion" so blocked recipes are never returned.
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(null);
    const result = await loadChampionRecipe(
      "anthropic",
      "claude-3-5-sonnet",
      "sync.chat",
    );
    expect(result).toBeNull();
    expect(prisma.executionRecipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "champion" }) }),
    );
  });

  it("returns highest version when multiple exist", async () => {
    const latestRecipe = {
      id: "recipe-3",
      providerId: "openai",
      modelId: "gpt-4o",
      contractFamily: "sync.code-gen",
      version: 3,
      status: "champion",
      origin: "mutation",
      providerSettings: { max_tokens: 8192 },
      toolPolicy: {},
      responsePolicy: {},
    };
    vi.mocked(prisma.executionRecipe.findFirst).mockResolvedValue(
      latestRecipe as any,
    );
    const result = await loadChampionRecipe("openai", "gpt-4o", "sync.code-gen");
    expect(result).toEqual(latestRecipe);
    expect(result?.version).toBe(3);
    // Confirm orderBy: version desc is in the call
    expect(prisma.executionRecipe.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { version: "desc" } }),
    );
  });
});
