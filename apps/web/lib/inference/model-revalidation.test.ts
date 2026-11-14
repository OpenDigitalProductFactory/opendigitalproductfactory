import { beforeEach, describe, expect, it, vi } from "vitest";

const findProviders = vi.hoisted(() => vi.fn());
const autoDiscover = vi.hoisted(() => vi.fn());
const findCapacity = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({
  prisma: { modelProvider: { findMany: findProviders }, providerCapacityStatus: { findMany: findCapacity } },
}));
vi.mock("./ai-provider-internals", () => ({ autoDiscoverAndProfile: autoDiscover }));
vi.mock("@/lib/routing/provider-eligibility", () => ({ canRunStartupModelDiscovery: () => true }));

import { runModelRevalidation } from "./model-revalidation";

function pool() {
  const client = {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [] }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client) } as never;
}

describe("runModelRevalidation", () => {
  beforeEach(() => {
    findProviders.mockReset();
    autoDiscover.mockReset();
    findCapacity.mockReset();
    findCapacity.mockResolvedValue([]);
    findProviders.mockResolvedValue([
      { providerId: "codex" },
      { providerId: "openai" },
    ]);
  });

  it("retains resolved provider errors instead of reporting the run as successful", async () => {
    autoDiscover
      .mockResolvedValueOnce({ discovered: 0, profiled: 0, error: "app-server unavailable" })
      .mockResolvedValueOnce({ discovered: 4, profiled: 4 });

    const result = await runModelRevalidation({ source: "scheduled" }, pool());

    expect(result).toEqual({
      acquired: true,
      outcomes: [
        { providerId: "codex", status: "failed", error: "app-server unavailable" },
        { providerId: "openai", status: "ok", discovered: 4, profiled: 4 },
      ],
    });
  });

  // BI-5A6C4011: the 03:10 refresh spent 21 calls per model every night on an
  // API key that said "no access until 2026-12-01" and on xai with no credential.
  it("skips a scheduled refresh for a provider whose recorded capacity says calls will fail", async () => {
    const now = Date.now();
    findProviders.mockResolvedValue([{ providerId: "anthropic" }, { providerId: "xai" }, { providerId: "codex" }, { providerId: "local" }]);
    findCapacity.mockResolvedValue([
      { providerId: "anthropic", state: "quota_resets_at", retryAt: new Date(now + 86400_000), lastObservedAt: new Date(now) },
      { providerId: "xai", state: "reauth_required", retryAt: null, lastObservedAt: new Date(now) },
      { providerId: "codex", state: "quota_resets_at", retryAt: new Date(now - 60_000), lastObservedAt: new Date(now - 86400_000) },
    ]);
    autoDiscover.mockResolvedValue({ discovered: 1, profiled: 1 });

    const result = await runModelRevalidation({ source: "scheduled" }, pool());

    expect(autoDiscover.mock.calls.map(([id]) => id)).toEqual(["codex", "local"]);
    expect(result.outcomes.filter((o) => o.status === "skipped").map((o) => o.providerId)).toEqual(["anthropic", "xai"]);
  });

  it("still refreshes every provider when the operator asks for it", async () => {
    findProviders.mockResolvedValue([{ providerId: "xai" }]);
    findCapacity.mockResolvedValue([{ providerId: "xai", state: "reauth_required", retryAt: null, lastObservedAt: new Date() }]);
    autoDiscover.mockResolvedValue({ discovered: 1, profiled: 1 });

    await runModelRevalidation({ source: "manual" }, pool());

    expect(autoDiscover).toHaveBeenCalledWith("xai");
  });
});
