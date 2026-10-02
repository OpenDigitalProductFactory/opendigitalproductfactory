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

describe("buildCustomerMap with service areas (BI-6CC10E4C)", () => {
  const square = (id: string, label: string, west: number, coveredBy?: { kind: "staffing-crew"; id: string }) => ({
    id,
    label,
    ...(coveredBy ? { coveredBy } : {}),
    geometry: {
      kind: "polygon" as const,
      rings: [[
        { longitude: west, latitude: 0 },
        { longitude: west + 6, latitude: 0 },
        { longitude: west + 6, latitude: 10 },
        { longitude: west, latitude: 10 },
        { longitude: west, latitude: 0 },
      ]],
    },
  });
  const areas = {
    version: 2,
    zones: [square("west", "West", 0, { kind: "staffing-crew", id: "CREW-1" }), square("east", "East", 4)],
    assignees: [{ kind: "staffing-crew" as const, id: "CREW-1", label: "North crew" }],
  };

  it("names sites outside every area, overlaps, and who covers each area (AC-COV-ANSWER-1/2)", () => {
    const map = buildCustomerMap(
      [
        site({ siteId: "a", latitude: 5, longitude: 1 }),
        site({ siteId: "b", latitude: 5, longitude: 5 }),
        site({ siteId: "c", latitude: 5, longitude: 20 }),
      ],
      areas,
    );
    expect(map.layout?.zones).toHaveLength(2);
    expect(map.coverage.outside.map((s) => s.siteId)).toEqual(["c"]);
    expect(map.coverage.overlaps).toEqual([expect.objectContaining({ zoneIds: ["west", "east"] })]);
    expect(map.coverage.bySite.a).toEqual(["west"]);
    expect(map.coverage.areas[0]).toEqual({
      zoneId: "west", label: "West", coveredBy: { kind: "staffing-crew", id: "CREW-1" }, coveredByLabel: "North crew", siteCount: 2,
    });
    expect(map.coverage.areas[1]).toMatchObject({ coveredBy: null, coveredByLabel: null, siteCount: 1 });
  });

  it("shows areas even before any site is placed", () => {
    const map = buildCustomerMap([], areas);
    expect(map.layout?.zones).toHaveLength(2);
    expect(map.coverage.outside).toEqual([]);
  });

  it("reports nothing as outside when no area exists (AC-COV-SAFE-1)", () => {
    const map = buildCustomerMap([site({ siteId: "a", latitude: 5, longitude: 1 })]);
    expect(map.coverage).toMatchObject({ version: 0, zones: [], areas: [], outside: [], overlaps: [] });
  });
});
