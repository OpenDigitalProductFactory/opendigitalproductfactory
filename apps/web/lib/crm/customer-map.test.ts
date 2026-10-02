import { describe, expect, it } from "vitest";

import { buildCustomerMap, type CustomerMapSite } from "./customer-map";

const site = (overrides: Partial<CustomerMapSite>): CustomerMapSite => ({
  siteId: "s1",
  siteName: "Head office",
  accountId: "a1",
  accountName: "Acme",
  addressLabel: "1 Main St, Austin",
  hasAddress: true,
  latitude: 30.27,
  longitude: -97.74,
  ...overrides,
});

describe("buildCustomerMap", () => {
  it("places only sites with coordinates and names the rest", () => {
    const map = buildCustomerMap([
      site({}),
      site({ siteId: "s2", accountId: "a2", accountName: "Beta", latitude: null, longitude: null }),
      site({ siteId: "s3", accountId: "a3", accountName: "Gamma", hasAddress: false, addressLabel: null, latitude: null, longitude: null }),
    ]);
    expect(map.layout?.placements.map((placement) => placement.entityRef.id)).toEqual(["s1"]);
    expect(map.unplaced.map((entry) => entry.siteId)).toEqual(["s2", "s3"]);
    expect(map.unplaced.map((entry) => entry.reason)).toEqual(["no-coordinates", "no-address"]);
  });

  it("labels each point with the account and the site", () => {
    const map = buildCustomerMap([site({})]);
    expect(map.layout?.placements[0]).toMatchObject({
      id: "site:s1",
      entityRef: { kind: "customer-site", id: "s1" },
      geometry: { kind: "point", latitude: 30.27, longitude: -97.74 },
    });
    expect(map.presentations.s1).toEqual({ label: "Acme", sublabel: "Head office" });
  });

  it("centres the viewport on the placed sites", () => {
    const map = buildCustomerMap([
      site({ latitude: 30, longitude: -98 }),
      site({ siteId: "s2", latitude: 32, longitude: -96 }),
    ]);
    expect(map.layout?.viewport).toMatchObject({ latitude: 31, longitude: -97 });
  });

  it("returns no layout when nothing can be placed", () => {
    const map = buildCustomerMap([site({ latitude: null, longitude: null })]);
    expect(map.layout).toBeNull();
    expect(map.unplaced).toHaveLength(1);
  });

  it("treats an out-of-range coordinate as missing", () => {
    const map = buildCustomerMap([site({ latitude: 95, longitude: 10 })]);
    expect(map.layout).toBeNull();
    expect(map.unplaced[0]?.reason).toBe("no-coordinates");
  });
});
