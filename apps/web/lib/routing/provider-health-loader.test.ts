import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: vi.fn(), findMany: vi.fn() },
    routeOutcome: { findMany: vi.fn() },
    providerCapacityStatus: { findUnique: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  Prisma: { join: vi.fn((values: string[]) => values) },
}));

import { loadProviderHealth, loadProviderHealthBatch } from "./provider-health-loader";
import { prisma } from "@dpf/db";

const mockProvider = prisma.modelProvider.findUnique as ReturnType<typeof vi.fn>;
const mockOutcomes = prisma.routeOutcome.findMany as ReturnType<typeof vi.fn>;
const mockCapacity = prisma.providerCapacityStatus.findUnique as ReturnType<typeof vi.fn>;
const mockProviderBatch = prisma.modelProvider.findMany as ReturnType<typeof vi.fn>;
const mockCapacityBatch = prisma.providerCapacityStatus.findMany as ReturnType<typeof vi.fn>;
const mockOutcomeBatch = prisma.$queryRaw as ReturnType<typeof vi.fn>;

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  mockCapacity.mockResolvedValue(null);
});

describe("loadProviderHealthBatch", () => {
  it("reconciles 25 providers with three shared queries", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => `provider-${index}`);
    mockProviderBatch.mockResolvedValue(ids.map((providerId) => ({
      providerId,
      status: "active",
      authMethod: "api_key",
    })));
    mockOutcomeBatch.mockResolvedValue(ids.map((providerId) => ({
      providerId,
      providerErrorCode: null,
      fallbackOccurred: false,
      createdAt: new Date(NOW - 1_000),
      latencyMs: 100,
      modelId: "model",
    })));
    mockCapacityBatch.mockResolvedValue([]);

    const result = await loadProviderHealthBatch(ids, { now: NOW });

    expect([...result.values()].every((entry) => entry.status === "fulfilled")).toBe(true);
    expect(mockProviderBatch).toHaveBeenCalledTimes(1);
    expect(mockOutcomeBatch).toHaveBeenCalledTimes(1);
    expect(mockCapacityBatch).toHaveBeenCalledTimes(1);
  });

  it("isolates a runtime reconciliation failure to one provider", async () => {
    mockProviderBatch.mockResolvedValue([
      { providerId: "openai", status: "active", authMethod: "api_key" },
      { providerId: "anthropic", status: "active", authMethod: "api_key" },
    ]);
    mockOutcomeBatch.mockResolvedValue([
      { providerId: "openai", providerErrorCode: null, fallbackOccurred: false, createdAt: new Date(NOW - 1_000), latencyMs: 100, modelId: "m" },
      { providerId: "anthropic", providerErrorCode: null, fallbackOccurred: false, createdAt: new Date(NOW - 1_000), latencyMs: 100, modelId: "m" },
    ]);
    mockCapacityBatch.mockResolvedValue([]);
    const runtimeState = vi.fn((providerId: string) => {
      if (providerId === "openai") throw new Error("private provider failure");
      return { unavailable: false };
    });

    const result = await loadProviderHealthBatch(["openai", "anthropic"], { now: NOW, runtimeState });

    expect(result.get("openai")).toEqual({ status: "rejected", configured: true });
    expect(result.get("anthropic")).toMatchObject({ status: "fulfilled", value: { status: "healthy" } });
  });
});

describe("loadProviderHealth", () => {
  it("returns unconfigured when the provider row does not exist", async () => {
    mockProvider.mockResolvedValue(null);
    mockOutcomes.mockResolvedValue([]);

    const health = await loadProviderHealth("ghost", { now: NOW });
    expect(health.status).toBe("unconfigured");
  });

  it("derives healthy from a recent successful outcome", async () => {
    mockProvider.mockResolvedValue({ status: "active", authMethod: "oauth2_authorization_code" });
    mockOutcomes.mockResolvedValue([
      { providerErrorCode: null, fallbackOccurred: false, createdAt: new Date(NOW - 1_000), latencyMs: 1200, modelId: "claude-opus-4-6" },
    ]);

    const health = await loadProviderHealth("anthropic-sub", { now: NOW });
    expect(health.status).toBe("healthy");
  });

  it("derives needs_reauth for a disabled provider with a recent auth error", async () => {
    mockProvider.mockResolvedValue({ status: "disabled", authMethod: "oauth2_authorization_code" });
    mockOutcomes.mockResolvedValue([
      { providerErrorCode: "auth", fallbackOccurred: false, createdAt: new Date(NOW - 2_000), latencyMs: 0, modelId: "gpt-5.3-codex" },
    ]);

    const health = await loadProviderHealth("codex", { now: NOW });
    expect(health.status).toBe("needs_reauth");
    expect(health.remediationKind).toBe("reauth");
    expect(health.adminActionHref).toBe("/platform/ai/providers/codex");
  });

  it("reflects an injected runtime cooldown (Slice A) over DB-only signal", async () => {
    mockProvider.mockResolvedValue({ status: "active", authMethod: "oauth2_authorization_code" });
    mockOutcomes.mockResolvedValue([
      { providerErrorCode: null, fallbackOccurred: false, createdAt: new Date(NOW - 1_000), latencyMs: 1000, modelId: "gpt-5.3-codex" },
    ]);

    const runtimeState = vi.fn(() => ({ unavailable: true, reason: "rate_limit", until: NOW + 30_000 }));
    const health = await loadProviderHealth("codex", { now: NOW, runtimeState });

    expect(runtimeState).toHaveBeenCalledWith("codex", "gpt-5.3-codex");
    expect(health.status).toBe("rate_limited");
    expect(health.cooldownUntil).toBe(NOW + 30_000);
  });

  it("does not call the runtime lookup when there is no telemetry to key on", async () => {
    mockProvider.mockResolvedValue({ status: "active", authMethod: "api_key" });
    mockOutcomes.mockResolvedValue([]);

    const runtimeState = vi.fn(() => ({ unavailable: false }));
    const health = await loadProviderHealth("gemini", { now: NOW, runtimeState });

    expect(runtimeState).not.toHaveBeenCalled();
    expect(health.status).toBe("unknown");
  });

  it("honors recentLimit when querying outcomes", async () => {
    mockProvider.mockResolvedValue({ status: "active", authMethod: "api_key" });
    mockOutcomes.mockResolvedValue([]);

    await loadProviderHealth("codex", { now: NOW, recentLimit: 5 });
    expect(mockOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, orderBy: { createdAt: "desc" } }),
    );
  });

  it("loads persisted provider capacity status", async () => {
    mockProvider.mockResolvedValue({ status: "active", authMethod: "api_key" });
    mockOutcomes.mockResolvedValue([
      { providerErrorCode: null, fallbackOccurred: false, createdAt: new Date(NOW - 1_000), latencyMs: 1000, modelId: "glm-5.2" },
    ]);
    mockCapacity.mockResolvedValue({
      state: "billing_action_required",
      action: "add_credits_or_plan",
      retryAt: null,
      safeSummary: "Z.ai needs coding credits.",
      isHumanActionRequired: true,
    });

    const health = await loadProviderHealth("zai-coding", { now: NOW });

    expect(mockCapacity).toHaveBeenCalledWith({
      where: { providerId: "zai-coding" },
      select: {
        state: true,
        action: true,
        retryAt: true,
        safeSummary: true,
        isHumanActionRequired: true,
      },
    });
    expect(health.status).toBe("billing");
    expect(health.safeSummary).toBe("Z.ai needs coding credits.");
  });
});
