import { describe, expect, it, vi } from "vitest";

import { runGeocodingBackfillPass, type BackfillDb } from "./backfill";
import type { GeocodingProvider } from "./providers";

const address = (id: string, line1: string) => ({
  id,
  addressLine1: line1,
  postalCode: "78701",
  city: { name: "Austin", region: { name: "Texas", code: "TX", country: { iso2: "US" } } },
});

function db(rows: ReturnType<typeof address>[], remainingAfter = 0) {
  return {
    address: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => remainingAfter),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } satisfies BackfillDb;
}

function provider(overrides: Partial<GeocodingProvider> = {}): GeocodingProvider {
  return {
    id: "census",
    enabled: true,
    batchSize: 2,
    minIntervalMs: 1000,
    geocode: vi.fn(async (inputs: Parameters<GeocodingProvider["geocode"]>[0]) =>
      inputs.map((input) =>
        input.line1.startsWith("Nowhere")
          ? { key: input.key, status: "not-found" as const }
          : { key: input.key, status: "found" as const, latitude: 30.27, longitude: -97.74, precision: "exact" as const },
      ),
    ),
    ...overrides,
  };
}

describe("runGeocodingBackfillPass", () => {
  it("does nothing with the none provider (AC-CMAP-PROVIDER-1)", async () => {
    const store = db([address("a1", "1 Main")]);
    const result = await runGeocodingBackfillPass(store, provider({ id: "none", enabled: false }), { fetchImpl: vi.fn(), sleep: vi.fn() });
    expect(result).toEqual({ ran: false, placed: 0, notFound: 0, remaining: null });
    expect(store.address.findMany).not.toHaveBeenCalled();
  });

  it("only selects addresses still missing coordinates", async () => {
    const store = db([]);
    await runGeocodingBackfillPass(store, provider(), { fetchImpl: vi.fn(), sleep: vi.fn() });
    const where = (store.address.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ latitude: null, status: "active" });
  });

  it("continues a sweep after the last address handled", async () => {
    const store = db([]);
    await runGeocodingBackfillPass(store, provider(), { fetchImpl: vi.fn(), sleep: vi.fn(), afterId: "a9" });
    const where = (store.address.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ id: { gt: "a9" } });
  });

  it("writes only where coordinates are still missing, never over a confirmed point (AC-CMAP-PROVIDER-2)", async () => {
    const store = db([address("a1", "1 Main"), address("a2", "Nowhere Rd"), address("a3", "3 Main")], 4);
    const sleep = vi.fn(async () => {});
    const result = await runGeocodingBackfillPass(store, provider(), { fetchImpl: vi.fn(), sleep, now: new Date("2026-10-02T00:00:00Z") });
    expect(result).toEqual({ ran: true, placed: 2, notFound: 1, remaining: 4, lastId: "a3", exhausted: true });
    const updates = store.address.updateMany.mock.calls.map((call) => (call as unknown as [{ where: unknown; data: unknown }])[0]);
    expect(updates[0]).toEqual({
      where: { id: "a1", latitude: null },
      data: { latitude: 30.27, longitude: -97.74, validatedAt: new Date("2026-10-02T00:00:00Z"), validationSource: "census" },
    });
    // Two batches of two (three addresses) are spaced by the provider's interval.
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("asks the provider once for addresses that normalize to the same text", async () => {
    const geocode = vi.fn(async (inputs: Parameters<GeocodingProvider["geocode"]>[0]) =>
      inputs.map((input) => ({ key: input.key, status: "found" as const, latitude: 1, longitude: 2, precision: "exact" as const })),
    );
    const store = db([address("a1", "1 Main St"), address("a2", "1  main st")]);
    const result = await runGeocodingBackfillPass(store, provider({ geocode, batchSize: 10 }), { fetchImpl: vi.fn(), sleep: vi.fn() });
    expect(geocode.mock.calls[0]?.[0]).toHaveLength(1);
    expect(result.placed).toBe(2);
  });
});
