import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { loadBuildStudioCapability } from "./build-studio-capability";

const mockModelProfileFindMany = vi.mocked(prisma.modelProfile.findMany);

describe("loadBuildStudioCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries active chat and code model profiles so Codex CLI can satisfy the Build Studio gate", async () => {
    mockModelProfileFindMany.mockResolvedValue([
      {
        providerId: "codex",
        modelId: "gpt-5.3-codex",
        supportsToolUse: true,
        maxInputTokens: null,
        provider: { name: "OpenAI Codex" },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.modelProfile.findMany>>);

    const result = await loadBuildStudioCapability();

    expect(mockModelProfileFindMany).toHaveBeenCalledWith({
      where: {
        modelClass: { in: ["chat", "code"] },
        modelStatus: { in: ["active", "degraded"] },
        provider: { status: "active" },
      },
      select: {
        providerId: true,
        modelId: true,
        supportsToolUse: true,
        maxInputTokens: true,
        provider: { select: { name: true } },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfyingProviderNames).toEqual(["OpenAI Codex"]);
    }
  });
});
