import { describe, expect, it, vi } from "vitest";

const { mockDiscover, mockInvalidate } = vi.hoisted(() => ({
  mockDiscover: vi.fn(),
  mockInvalidate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { discoveredModel: { findFirst: vi.fn() } } }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({
  autoDiscoverAndProfile: mockDiscover,
  PROVIDER_CATALOG_REFRESH_EVENT: "inference/provider-catalog-refresh.requested",
}));
vi.mock("@/lib/routing/loader", () => ({ invalidateRoutingLoaderCache: mockInvalidate }));
vi.mock("../quiescence-gates", () => ({ gateAtEntry: vi.fn(async () => ({ proceed: true })) }));
vi.mock("../inngest-client", () => ({
  inngest: {
    createFunction: vi.fn((config: unknown, handler: unknown) => ({ config, handler })),
  },
}));

import { prisma } from "@dpf/db";
import {
  PROVIDER_CATALOG_REFRESH_DEBOUNCE_MS,
  PROVIDER_CATALOG_REFRESH_EVENT,
  providerCatalogRefresh,
  providerCatalogRefreshDue,
  type ProviderCatalogRefreshDb,
} from "./provider-catalog-refresh";

const now = new Date("2026-09-15T12:00:00.000Z");

describe("providerCatalogRefreshDue", () => {
  it("is due when nothing was ever discovered or the newest discovery is older than the debounce", async () => {
    const db = { discoveredModel: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as ProviderCatalogRefreshDb;
    expect(await providerCatalogRefreshDue(db, "codex", now)).toBe(true);
    const old = { discoveredModel: { findFirst: vi.fn().mockResolvedValue({ lastSeenAt: new Date(now.getTime() - PROVIDER_CATALOG_REFRESH_DEBOUNCE_MS) }) } } as unknown as ProviderCatalogRefreshDb;
    expect(await providerCatalogRefreshDue(old, "codex", now)).toBe(true);
  });

  it("is not due inside the debounce window", async () => {
    const recent = { discoveredModel: { findFirst: vi.fn().mockResolvedValue({ lastSeenAt: new Date(now.getTime() - 60_000) }) } } as unknown as ProviderCatalogRefreshDb;
    expect(await providerCatalogRefreshDue(recent, "codex", now)).toBe(false);
  });
});

describe("providerCatalogRefresh function", () => {
  const fn = providerCatalogRefresh as unknown as {
    config: { id: string; triggers: Array<{ event?: string }>; concurrency: unknown };
    handler: (ctx: { event: { data: Record<string, unknown> }; step: { run: (name: string, f: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
  };
  const run = vi.fn(async (_name: string, f: () => Promise<unknown>) => f());

  it("is event-triggered, per-provider serialized, and re-discovers when due", async () => {
    expect(fn.config.id).toBe("inference/provider-catalog-refresh");
    expect(fn.config.triggers[0].event).toBe(PROVIDER_CATALOG_REFRESH_EVENT);
    (prisma.discoveredModel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mockDiscover.mockResolvedValue({ discovered: 7, profiled: 7 });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await fn.handler({ event: { data: { providerId: "codex", reason: "refused" } }, step: { run } });

    expect(mockDiscover).toHaveBeenCalledWith("codex");
    expect(mockInvalidate).toHaveBeenCalled();
    expect(result).toMatchObject({ skipped: false, providerId: "codex" });
    info.mockRestore();
  });

  it("skips inside the debounce window and on a missing providerId", async () => {
    mockDiscover.mockClear();
    (prisma.discoveredModel.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ lastSeenAt: new Date() });
    expect(await fn.handler({ event: { data: { providerId: "codex", reason: "r" } }, step: { run } })).toMatchObject({ skipped: true, reason: "debounced" });
    expect(await fn.handler({ event: { data: {} }, step: { run } })).toMatchObject({ skipped: true, reason: "missing providerId" });
    expect(mockDiscover).not.toHaveBeenCalled();
  });
});
