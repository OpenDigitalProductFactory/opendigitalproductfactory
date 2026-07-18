import { describe, expect, it } from "vitest";

import {
  correlateDiscoveryToAssets,
  matchInventoryEntityToAsset,
  type AssetBridgeFixedAsset,
  type AssetBridgeInventoryEntity,
} from "./inventory-asset-bridge";

const entity = (id: string, serial?: string | null): AssetBridgeInventoryEntity => ({
  id,
  properties: serial === undefined ? {} : serial === null ? null : { serialNumber: serial },
});
const asset = (id: string, serialNumber: string | null): AssetBridgeFixedAsset => ({ id, serialNumber });

describe("matchInventoryEntityToAsset", () => {
  it("matches on serial (case-insensitive)", () => {
    const m = matchInventoryEntityToAsset(entity("e-1", "ABC-123"), [asset("fa-1", "abc-123")]);
    expect(m).toEqual({ inventoryEntityId: "e-1", fixedAssetId: "fa-1", method: "serial", confidence: 0.99 });
  });

  it("fail-closes when the device has no serial", () => {
    expect(matchInventoryEntityToAsset(entity("e-1"), [asset("fa-1", "abc-123")])).toBeNull();
    expect(matchInventoryEntityToAsset(entity("e-1", null), [asset("fa-1", "abc-123")])).toBeNull();
  });

  it("does not match an asset with no serial", () => {
    expect(matchInventoryEntityToAsset(entity("e-1", "abc-123"), [asset("fa-1", null)])).toBeNull();
  });

  it("also reads a `serial` property key", () => {
    const m = matchInventoryEntityToAsset({ id: "e-2", properties: { serial: "SN9" } }, [asset("fa-9", "sn9")]);
    expect(m?.fixedAssetId).toBe("fa-9");
  });
});

describe("correlateDiscoveryToAssets", () => {
  it("buckets capitalized-and-discovered, on-books-not-discovered, and un-capitalized", () => {
    const assets = [
      asset("fa-live", "SN-LIVE"), // matched by a discovered device
      asset("fa-ghost", "SN-GHOST"), // on the books, never seen
    ];
    const entities = [
      entity("e-live", "SN-LIVE"), // matches fa-live
      entity("e-uncap", "SN-NEW"), // serial, no asset → un-capitalized candidate
      entity("e-noserial"), // no serial → not assessable, excluded from all counts
    ];

    const r = correlateDiscoveryToAssets(entities, assets);
    expect(r.capitalizedAndDiscovered).toBe(1); // fa-live
    expect(r.capitalizedNotDiscovered).toBe(1); // fa-ghost
    expect(r.discoveredNotCapitalized).toBe(1); // e-uncap
    expect(r.serialBearingDevices).toBe(2); // e-live + e-uncap (e-noserial excluded)
    expect(r.matches).toEqual([
      { inventoryEntityId: "e-live", fixedAssetId: "fa-live", method: "serial", confidence: 0.99 },
    ]);
  });

  it("counts an empty reconciliation cleanly", () => {
    expect(correlateDiscoveryToAssets([], [])).toEqual({
      matches: [],
      capitalizedAndDiscovered: 0,
      capitalizedNotDiscovered: 0,
      discoveredNotCapitalized: 0,
      serialBearingDevices: 0,
    });
  });
});
