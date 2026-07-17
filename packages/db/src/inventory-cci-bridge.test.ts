import { describe, expect, it } from "vitest";

import {
  correlateDiscoveryToEstate,
  matchInventoryEntityToCci,
  type BridgeConfigurationItem,
  type BridgeInventoryEntity,
} from "./inventory-cci-bridge";

const cci = (over: Partial<BridgeConfigurationItem>): BridgeConfigurationItem => ({
  id: "cci-1",
  accountId: "acct-1",
  siteId: null,
  manufacturer: "Dell",
  vendorName: null,
  productModel: "PowerEdge R750",
  productName: null,
  serialNumber: null,
  assetTag: null,
  ...over,
});

const entity = (over: Partial<BridgeInventoryEntity>): BridgeInventoryEntity => ({
  id: "e-1",
  manufacturer: "Dell",
  productModel: "PowerEdge R750",
  name: "srv-01",
  customerAccountId: "acct-1",
  customerSiteId: null,
  properties: null,
  ...over,
});

describe("matchInventoryEntityToCci", () => {
  it("matches on serial number first (exact, case-insensitive)", () => {
    const m = matchInventoryEntityToCci(
      entity({ properties: { serialNumber: "ABC123" }, productModel: "wrong" }),
      [cci({ id: "cci-serial", serialNumber: "abc123", productModel: "irrelevant" })],
    );
    expect(m).toEqual({ inventoryEntityId: "e-1", configurationItemId: "cci-serial", method: "serial", confidence: 0.99 });
  });

  it("matches on asset tag when there is no serial", () => {
    const m = matchInventoryEntityToCci(
      entity({ properties: { assetTag: "AT-9" }, manufacturer: null, productModel: null }),
      [cci({ id: "cci-tag", assetTag: "AT-9" })],
    );
    expect(m?.method).toBe("asset_tag");
    expect(m?.confidence).toBe(0.95);
  });

  it("falls back to manufacturer+model match", () => {
    const m = matchInventoryEntityToCci(entity({}), [cci({ id: "cci-model" })]);
    expect(m).toEqual({ inventoryEntityId: "e-1", configurationItemId: "cci-model", method: "model", confidence: 0.8 });
  });

  it("does NOT match a different manufacturer even with the same model string", () => {
    expect(matchInventoryEntityToCci(entity({ manufacturer: "HP" }), [cci({})])).toBeNull();
  });

  it("never crosses customer account scope", () => {
    expect(matchInventoryEntityToCci(entity({ customerAccountId: "acct-2" }), [cci({})])).toBeNull();
  });

  it("does not match across sites when both name a site", () => {
    expect(
      matchInventoryEntityToCci(entity({ customerSiteId: "site-a" }), [cci({ siteId: "site-b" })]),
    ).toBeNull();
    // …but an account-level match is allowed when the device has no site yet.
    expect(
      matchInventoryEntityToCci(entity({ customerSiteId: null }), [cci({ siteId: "site-b" })]),
    ).not.toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchInventoryEntityToCci(entity({ manufacturer: "Acme", productModel: "Nonesuch" }), [cci({})])).toBeNull();
  });
});

describe("correlateDiscoveryToEstate", () => {
  it("buckets managed-and-discovered, managed-not-discovered, and shadow devices", () => {
    const ccis = [
      cci({ id: "cci-r750", productModel: "PowerEdge R750" }),
      cci({ id: "cci-r640", productModel: "PowerEdge R640" }), // managed, never discovered
    ];
    const entities = [
      entity({ id: "e-r750", productModel: "PowerEdge R750" }), // matches cci-r750
      entity({ id: "e-shadow", manufacturer: "Ubiquiti", productModel: "UDM Pro" }), // no CCI → shadow
    ];

    const result = correlateDiscoveryToEstate(entities, ccis);
    expect(result.managedAndDiscovered).toBe(1);
    expect(result.managedNotDiscovered).toBe(1); // cci-r640
    expect(result.discoveredNotManaged).toBe(1); // e-shadow
    expect(result.matches).toEqual([
      { inventoryEntityId: "e-r750", configurationItemId: "cci-r750", method: "model", confidence: 0.8 },
    ]);
  });

  it("counts an empty estate cleanly", () => {
    expect(correlateDiscoveryToEstate([], [])).toEqual({
      matches: [],
      managedAndDiscovered: 0,
      managedNotDiscovered: 0,
      discoveredNotManaged: 0,
    });
  });
});
