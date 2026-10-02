import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  require: vi.fn(),
  findSite: vi.fn(),
  updateAddress: vi.fn(),
  saveConfig: vi.fn(),
  startBackfill: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: m.require }));
vi.mock("@dpf/db", () => ({
  prisma: { customerSite: { findFirst: m.findSite }, address: { update: m.updateAddress } },
}));
vi.mock("@/lib/geocoding/backfill.server", () => ({
  saveGeocodingConfig: m.saveConfig,
  startGeocodingBackfill: m.startBackfill,
}));

import {
  placeCustomerSiteOnMapAction,
  saveGeocodingProviderAction,
  startGeocodingBackfillAction,
} from "./customer-map";

beforeEach(() => {
  vi.resetAllMocks();
  m.require.mockResolvedValue({ userId: "u1" });
});

describe("placeCustomerSiteOnMapAction (AC-CMAP-FIX-2)", () => {
  it("stores the point as a manual pin on the site's address", async () => {
    m.findSite.mockResolvedValue({ primaryAddressId: "addr-1" });
    expect(await placeCustomerSiteOnMapAction("site-1", 30.27, -97.74)).toEqual({ ok: true });
    expect(m.require).toHaveBeenCalledWith("operate_customer");
    expect(m.updateAddress).toHaveBeenCalledWith({
      where: { id: "addr-1" },
      data: expect.objectContaining({ latitude: 30.27, longitude: -97.74, validationSource: "manual-pin" }),
    });
  });

  it("refuses without the capability, out-of-range points and sites without an address", async () => {
    m.require.mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await placeCustomerSiteOnMapAction("site-1", 1, 1)).toEqual({ ok: false, error: "forbidden" });
    expect(await placeCustomerSiteOnMapAction("site-1", 91, 1)).toEqual({ ok: false, error: "invalid-point" });
    m.findSite.mockResolvedValue({ primaryAddressId: null });
    expect(await placeCustomerSiteOnMapAction("site-1", 1, 1)).toEqual({ ok: false, error: "no-address" });
    expect(m.updateAddress).not.toHaveBeenCalled();
  });
});

describe("geocoding administration", () => {
  it("needs manage_platform to change the provider or start a backfill", async () => {
    m.require.mockRejectedValue(new Error("Unauthorized"));
    expect(await saveGeocodingProviderAction({ provider: "census" })).toEqual({ ok: false, error: "forbidden" });
    expect(await startGeocodingBackfillAction()).toEqual({ ok: false, error: "forbidden" });
    expect(m.saveConfig).not.toHaveBeenCalled();
    expect(m.startBackfill).not.toHaveBeenCalled();
  });

  it("reports why a backfill did not start", async () => {
    m.startBackfill.mockResolvedValue({ started: false, reason: "no-provider" });
    expect(await startGeocodingBackfillAction()).toEqual({ ok: false, error: "no-provider" });
    expect(m.require).toHaveBeenCalledWith("manage_platform");
  });
});
