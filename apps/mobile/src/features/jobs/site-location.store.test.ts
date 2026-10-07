import type { WorkItemSite } from "@dpf/types";
import { useSiteLocationStore } from "./site-location.store";

const mockSites = jest.fn();
const mockConfirm = jest.fn();
const mockFix = jest.fn();
const mockGet = jest.fn();
const mockSet = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: { workItems: { sites: (...a: unknown[]) => mockSites(...a), confirmSiteLocation: (...a: unknown[]) => mockConfirm(...a) } },
}));
jest.mock("@/src/hooks/useGeolocation", () => ({ takeOneFix: () => mockFix() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: (...a: unknown[]) => mockGet(...a),
  setItemAsync: (...a: unknown[]) => mockSet(...a),
}));

const SITE: WorkItemSite = { id: "s1", name: "HQ", addressLine: "1 Main", hasAddress: true, hasLocation: false, locationConfirmed: false };
const FIX = { status: "fix", latitude: 30.2671, longitude: -97.7431, accuracyMeters: 8 };

beforeEach(() => {
  [mockSites, mockConfirm, mockFix, mockGet, mockSet].forEach((m) => m.mockReset());
  mockGet.mockResolvedValue(null);
  mockSites.mockResolvedValue({ sites: [SITE] });
  useSiteLocationStore.getState().reset();
});

describe("site location offer at check-in (AC-ALC-VISIT-1, AC-ALC-VISIT-4)", () => {
  it("prepares the offer without reading the device's position", async () => {
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    expect(useSiteLocationStore.getState().offer).toEqual({ kind: "one", site: SITE });
    expect(mockFix).not.toHaveBeenCalled();
  });

  it("takes one fix only on the tap and confirms the site", async () => {
    mockFix.mockResolvedValue(FIX);
    mockConfirm.mockResolvedValue({ status: "confirmed", latitude: 30.2671, longitude: -97.7431 });
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    await useSiteLocationStore.getState().locateAndConfirm(SITE);
    expect(mockFix).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith("s1", { workItemId: "WI-1", latitude: 30.2671, longitude: -97.7431, accuracyMeters: 8, confirmFar: false });
    expect(useSiteLocationStore.getState().phase).toEqual({ kind: "done", site: SITE });
  });

  it("asks before accepting a far fix, then reuses the same fix", async () => {
    mockFix.mockResolvedValue(FIX);
    mockConfirm
      .mockResolvedValueOnce({ status: "refused", reason: "far-from-address", distanceMeters: 3400 })
      .mockResolvedValueOnce({ status: "confirmed", latitude: 30.2671, longitude: -97.7431 });
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    await useSiteLocationStore.getState().locateAndConfirm(SITE);
    expect(useSiteLocationStore.getState().phase).toEqual({ kind: "far", site: SITE, distanceMeters: 3400 });
    await useSiteLocationStore.getState().confirmFar(SITE);
    expect(mockFix).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenLastCalledWith("s1", expect.objectContaining({ confirmFar: true }));
    expect(useSiteLocationStore.getState().pendingFix).toBeNull();
  });

  it("does nothing more when permission is denied", async () => {
    mockFix.mockResolvedValue({ status: "denied" });
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    await useSiteLocationStore.getState().locateAndConfirm(SITE);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(useSiteLocationStore.getState().phase).toMatchObject({ kind: "message" });
  });

  it("remembers Not now on the device", async () => {
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    await useSiteLocationStore.getState().notNow(["s1"], new Date("2026-10-07T12:00:00Z"));
    expect(useSiteLocationStore.getState().offer).toEqual({ kind: "none" });
    expect(mockSet).toHaveBeenCalledWith("dpf_site_location_not_now", JSON.stringify({ s1: "2026-10-07T12:00:00.000Z" }));
  });

  it("offers nothing when the sites cannot be loaded", async () => {
    mockSites.mockRejectedValue(new Error("offline"));
    await useSiteLocationStore.getState().prepareOffer("WI-1");
    expect(useSiteLocationStore.getState().offer).toEqual({ kind: "none" });
  });
});
