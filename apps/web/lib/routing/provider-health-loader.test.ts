import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: { findUnique: vi.fn() },
    routeOutcome: { findMany: vi.fn() },
  },
}));

import { loadProviderHealth } from "./provider-health-loader";
import { prisma } from "@dpf/db";

const mockProvider = prisma.modelProvider.findUnique as ReturnType<typeof vi.fn>;
const mockOutcomes = prisma.routeOutcome.findMany as ReturnType<typeof vi.fn>;

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
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
});
