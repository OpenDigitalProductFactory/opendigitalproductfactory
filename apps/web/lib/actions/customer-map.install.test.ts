import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  recommend: vi.fn(),
  readStatus: vi.fn(),
  writeStatus: vi.fn(),
  send: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: m.requireCapability }));
vi.mock("@/lib/geocoding/backfill.server", () => ({ saveGeocodingConfig: vi.fn(), startGeocodingBackfill: vi.fn() }));
vi.mock("@/lib/twin/map-region-recommendation.server", () => ({ loadMapRegionRecommendation: m.recommend }));
vi.mock("@/lib/twin/map-pack-install/status.server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/twin/map-pack-install/status.server")>("@/lib/twin/map-pack-install/status.server");
  return { ...actual, readInstallStatus: m.readStatus, writeInstallStatus: m.writeStatus };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: m.send } }));

import { installRecommendedMapPackAction } from "./customer-map";

const bounds = { west: -98, south: 37, east: -96, north: 38 };
const groups = [
  { label: "Texas, United States", regionName: "Texas", countryIso2: "US", suggestedPackId: "us-texas", pointCount: 2, bounds, coveredBy: "us-texas" },
  { label: "Kansas, United States", regionName: "Kansas", countryIso2: "US", suggestedPackId: "us-kansas", pointCount: 1, bounds, coveredBy: null },
];

describe("installRecommendedMapPackAction (BI-43BBCC26)", () => {
  beforeEach(() => {
    Object.values(m).forEach((fn) => fn.mockReset());
    m.requireCapability.mockResolvedValue(undefined);
    m.recommend.mockResolvedValue({ status: "partly-covered", groups });
    m.readStatus.mockResolvedValue({ state: "idle", updatedAt: null });
    m.send.mockResolvedValue({ ids: ["e1"] });
  });

  it("refuses without manage_platform", async () => {
    m.requireCapability.mockRejectedValue(new Error("no"));
    expect(await installRecommendedMapPackAction("us-kansas")).toEqual({ ok: false, error: "forbidden" });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("installs only a pack recommended for an uncovered region, with server-computed bounds", async () => {
    expect(await installRecommendedMapPackAction("us-texas")).toEqual({ ok: false, error: "not-recommended" });
    expect(await installRecommendedMapPackAction("us-anywhere")).toEqual({ ok: false, error: "not-recommended" });
    expect(await installRecommendedMapPackAction("us-kansas")).toEqual({ ok: true });
    expect(m.send).toHaveBeenCalledWith({
      name: "map-pack/install.requested",
      data: { packId: "us-kansas", region: "Kansas, United States", bounds, locale: "en-US" },
    });
  });

  it("refuses while another install is running", async () => {
    m.readStatus.mockResolvedValue({ state: "downloading", updatedAt: new Date().toISOString() });
    expect(await installRecommendedMapPackAction("us-kansas")).toEqual({ ok: false, error: "already-running" });
  });
});
