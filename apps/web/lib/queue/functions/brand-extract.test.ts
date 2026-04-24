import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BrandDesignSystem } from "@/lib/brand/types";

const mocks = vi.hoisted(() => ({
  extractBrandDesignSystem: vi.fn(),
  pushThreadProgress: vi.fn(),
  designSystemToThemeTokens: vi.fn(),
  taskRunUpdate: vi.fn(),
  organizationUpdate: vi.fn(),
  brandingConfigUpsert: vi.fn(),
  agentMessageCreate: vi.fn(),
  agentAttachmentFindMany: vi.fn(),
}));

vi.mock("@/lib/brand/extraction", () => ({
  extractBrandDesignSystem: mocks.extractBrandDesignSystem,
}));

vi.mock("@/lib/tak/thread-progress", () => ({
  pushThreadProgress: mocks.pushThreadProgress,
}));

vi.mock("@/lib/brand/apply", () => ({
  designSystemToThemeTokens: mocks.designSystemToThemeTokens,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { update: mocks.taskRunUpdate },
    organization: { update: mocks.organizationUpdate },
    brandingConfig: { upsert: mocks.brandingConfigUpsert },
    agentMessage: { create: mocks.agentMessageCreate },
    agentAttachment: { findMany: mocks.agentAttachmentFindMany },
  },
}));

import { runBrandExtraction } from "./brand-extract";

function minimalDesignSystem(): BrandDesignSystem {
  return {
    version: "1.0.0",
    extractedAt: "2026-04-18T00:00:00.000Z",
    sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
    identity: {
      name: "Acme",
      tagline: null,
      description: null,
      logo: { darkBg: null, lightBg: null, mark: null },
      voice: { tone: "neutral", sampleCopy: [] },
    },
    palette: {
      primary: "#336699",
      secondary: null,
      accents: [],
      semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
      neutrals: {
        50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
        500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
      },
      surfaces: {
        background: "#ffffff", foreground: "#000000", muted: "#f5f5f5", card: "#ffffff", border: "#e5e5e5",
      },
    },
    typography: {
      families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
      scale: {
        xs: { size: "0.75rem", lineHeight: "1rem", tracking: "0", weight: 400 },
        sm: { size: "0.875rem", lineHeight: "1.25rem", tracking: "0", weight: 400 },
        base: { size: "1rem", lineHeight: "1.5rem", tracking: "0", weight: 400 },
        lg: { size: "1.125rem", lineHeight: "1.75rem", tracking: "0", weight: 400 },
        xl: { size: "1.25rem", lineHeight: "1.75rem", tracking: "0", weight: 500 },
        "2xl": { size: "1.5rem", lineHeight: "2rem", tracking: "0", weight: 600 },
        "3xl": { size: "1.875rem", lineHeight: "2.25rem", tracking: "0", weight: 700 },
        "4xl": { size: "2.25rem", lineHeight: "2.5rem", tracking: "0", weight: 700 },
        "5xl": { size: "3rem", lineHeight: "1", tracking: "0", weight: 700 },
        "6xl": { size: "3.75rem", lineHeight: "1", tracking: "0", weight: 700 },
      },
      pairings: [],
    },
    components: { library: "shadcn", inventory: [], patterns: [] },
    tokens: { radii: {}, spacing: {}, shadows: {}, motion: {}, breakpoints: {} },
    confidence: { overall: 0.7, perField: {} },
    gaps: [],
    overrides: {},
  };
}

describe("runBrandExtraction (core handler)", () => {
  beforeEach(() => {
    mocks.extractBrandDesignSystem.mockReset();
    mocks.pushThreadProgress.mockReset();
    mocks.designSystemToThemeTokens.mockReset();
    mocks.taskRunUpdate.mockReset();
    mocks.organizationUpdate.mockReset();
    mocks.brandingConfigUpsert.mockReset();
    mocks.agentMessageCreate.mockReset();
    mocks.agentAttachmentFindMany.mockReset();

    mocks.taskRunUpdate.mockResolvedValue({});
    mocks.organizationUpdate.mockResolvedValue({});
    mocks.brandingConfigUpsert.mockResolvedValue({});
    mocks.agentMessageCreate.mockResolvedValue({});
    mocks.agentAttachmentFindMany.mockResolvedValue([]);
    mocks.designSystemToThemeTokens.mockReturnValue({ dark: {}, light: {} });
  });

  it("writes Organization.designSystem on success", async () => {
    mocks.extractBrandDesignSystem.mockResolvedValue({
      designSystem: minimalDesignSystem(),
      sourcesUsed: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      durationMs: 5000,
    });

    await runBrandExtraction({
      organizationId: "org-1",
      taskRunId: "run-1",
      userId: "user-1",
      threadId: "thread-1",
      sources: { url: "https://example.com" },
    });

    expect(mocks.organizationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: expect.objectContaining({
          designSystem: expect.objectContaining({ version: "1.0.0" }),
        }),
      }),
    );
  });

  it("upserts BrandingConfig.tokens via designSystemToThemeTokens", async () => {
    mocks.extractBrandDesignSystem.mockResolvedValue({
      designSystem: minimalDesignSystem(),
      sourcesUsed: [],
      durationMs: 5000,
    });

    await runBrandExtraction({
      organizationId: "org-1",
      taskRunId: "run-1",
      userId: "user-1",
      threadId: null,
      sources: { url: "https://example.com" },
    });

    expect(mocks.designSystemToThemeTokens).toHaveBeenCalled();
    expect(mocks.brandingConfigUpsert).toHaveBeenCalled();
  });

  it("marks TaskRun completed and posts a summary AgentMessage", async () => {
    mocks.extractBrandDesignSystem.mockResolvedValue({
      designSystem: minimalDesignSystem(),
      sourcesUsed: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      durationMs: 5000,
    });

    await runBrandExtraction({
      organizationId: "org-1",
      taskRunId: "run-1",
      userId: "user-1",
      threadId: "thread-1",
      sources: { url: "https://example.com" },
    });

    expect(mocks.taskRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskRunId: "run-1" },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
    expect(mocks.agentMessageCreate).toHaveBeenCalled();
  });

  it("marks TaskRun failed and posts an error message when extraction throws", async () => {
    mocks.extractBrandDesignSystem.mockRejectedValue(new Error("URL timeout"));

    await expect(
      runBrandExtraction({
        organizationId: "org-1",
        taskRunId: "run-1",
        userId: "user-1",
        threadId: "thread-1",
        sources: { url: "https://example.com" },
      }),
    ).rejects.toThrow("URL timeout");

    expect(mocks.taskRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(mocks.agentMessageCreate).toHaveBeenCalled();
  });

  it("does not post an AgentMessage when threadId is null", async () => {
    mocks.extractBrandDesignSystem.mockResolvedValue({
      designSystem: minimalDesignSystem(),
      sourcesUsed: [],
      durationMs: 5000,
    });

    await runBrandExtraction({
      organizationId: "org-1",
      taskRunId: "run-1",
      userId: "user-1",
      threadId: null,
      sources: { url: "https://example.com" },
    });

    expect(mocks.agentMessageCreate).not.toHaveBeenCalled();
  });
});
