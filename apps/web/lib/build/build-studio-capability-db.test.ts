import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      findMany: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    buildEngine: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { loadBuildStudioCapability } from "./build-studio-capability";

const mockModelProfileFindMany = vi.mocked(prisma.modelProfile.findMany);
const mockModelProviderFindMany = vi.mocked(prisma.modelProvider.findMany);
const mockBuildEngineFindFirst = vi.mocked(prisma.buildEngine.findFirst);

describe("loadBuildStudioCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing merely disabled.
    mockModelProviderFindMany.mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof prisma.modelProvider.findMany>>,
    );
    // Default: opencode engine not present (preserves pre-opencode gate behavior).
    mockBuildEngineFindFirst.mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof prisma.buildEngine.findFirst>>,
    );
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

  it("queries inactive CLI runners and surfaces them as enableable when the gate is closed", async () => {
    mockModelProfileFindMany.mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof prisma.modelProfile.findMany>>,
    );
    mockModelProviderFindMany.mockResolvedValue([
      { providerId: "anthropic-sub", name: "Claude / Anthropic (OAuth Subscription)", cliEngine: "claude" },
    ] as unknown as Awaited<ReturnType<typeof prisma.modelProvider.findMany>>);

    const result = await loadBuildStudioCapability();

    expect(mockModelProviderFindMany).toHaveBeenCalledWith({
      where: { status: "inactive", cliEngine: { not: null } },
      select: { providerId: true, name: true, cliEngine: true },
      orderBy: { providerId: "asc" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.enableableRunners).toEqual([
        { providerId: "anthropic-sub", name: "Claude / Anthropic (OAuth Subscription)", shortLabel: "Claude" },
      ]);
    }
  });

  it("opens the gate for a local strong-tier model when the opencode engine is present (baked-in/probed)", async () => {
    mockModelProfileFindMany.mockResolvedValue([
      {
        providerId: "local",
        modelId: "docker.io/ai/qwen3-coder:latest",
        supportsToolUse: false, // local API flag — opencode supplies the tool loop
        maxInputTokens: null,
        provider: { name: "Docker Model Runner (local)" },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.modelProfile.findMany>>);
    mockBuildEngineFindFirst.mockResolvedValue(
      { bakeInDefault: true, state: { present: true } } as unknown as Awaited<
        ReturnType<typeof prisma.buildEngine.findFirst>
      >,
    );

    const result = await loadBuildStudioCapability();

    expect(mockBuildEngineFindFirst).toHaveBeenCalledWith({
      where: { engineId: "opencode" },
      select: { bakeInDefault: true, state: { select: { present: true } } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfyingProviderNames).toEqual(["Docker Model Runner (local)"]);
    }
  });

  it("keeps the gate closed for a local model when the opencode engine is absent", async () => {
    mockModelProfileFindMany.mockResolvedValue([
      {
        providerId: "local",
        modelId: "docker.io/ai/qwen3-coder:latest",
        supportsToolUse: false,
        maxInputTokens: null,
        provider: { name: "Docker Model Runner (local)" },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.modelProfile.findMany>>);
    // buildEngine.findFirst → null (default from beforeEach)

    const result = await loadBuildStudioCapability();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("only_local_provider_active");
    }
  });

  it("keeps the gate closed when opencode is bakeInDefault but NOT actually present (image drift → BI-9394E7C5)", async () => {
    // The exact failure that hard-crashes builds at exit 127: the engine is
    // marked baked-in-by-default, but its binary is missing from the image.
    // Availability must follow runtime presence, not the config-intent flag.
    mockModelProfileFindMany.mockResolvedValue([
      {
        providerId: "local",
        modelId: "docker.io/ai/qwen3-coder:latest",
        supportsToolUse: false,
        maxInputTokens: null,
        provider: { name: "Docker Model Runner (local)" },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.modelProfile.findMany>>);
    mockBuildEngineFindFirst.mockResolvedValue(
      { bakeInDefault: true, state: { present: false } } as unknown as Awaited<
        ReturnType<typeof prisma.buildEngine.findFirst>
      >,
    );

    const result = await loadBuildStudioCapability();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("only_local_provider_active");
    }
  });
});
