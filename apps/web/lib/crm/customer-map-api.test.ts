import { describe, expect, it } from "vitest";

import { buildCustomerMap } from "./customer-map";
import { buildCustomerSitesMapPayload } from "./customer-map-api";

const site = (siteId: string, latitude: number | null, longitude: number | null) => ({
  siteId,
  siteName: "HQ",
  accountId: `acct-${siteId}`,
  accountName: "Acme",
  addressLabel: "1 Main",
  hasAddress: true,
  latitude,
  longitude,
});

const texas = {
  packId: "us-texas",
  attribution: "© OpenStreetMap contributors",
  bounds: { west: -107, south: 25, east: -93, north: 37 },
};

describe("buildCustomerSitesMapPayload (AC-PMR-SCENE-1)", () => {
  it("returns the scene, the not-on-the-map count and the covering pack", () => {
    const payload = buildCustomerSitesMapPayload(buildCustomerMap([site("a", 30.27, -97.74), site("b", null, null)]), [texas]);
    expect(payload.basemap).toBe("available");
    expect(payload.pack?.packId).toBe("us-texas");
    expect(payload.notOnMap).toBe(1);
    expect(payload.model?.placements.features).toHaveLength(1);
    expect(payload.model?.placements.features[0]?.properties.entityId).toBe("a");
  });

  it("says why there is no street map", () => {
    const placed = buildCustomerMap([site("a", 51.5, -0.12)]);
    expect(buildCustomerSitesMapPayload(placed, []).basemap).toBe("no-pack-installed");
    expect(buildCustomerSitesMapPayload(placed, [texas]).basemap).toBe("out-of-coverage");
    expect(buildCustomerSitesMapPayload(buildCustomerMap([]), [texas])).toEqual({
      model: null,
      notOnMap: 0,
      pack: null,
      basemap: "nothing-to-show",
    });
  });
});
