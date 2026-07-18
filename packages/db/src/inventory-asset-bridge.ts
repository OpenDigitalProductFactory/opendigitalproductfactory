// InventoryEntity ↔ FixedAsset reconciliation (BI-1093AF1C, HAM Phase D2, spec §7).
//
// Reconciles DISCOVERED devices (InventoryEntity) with the finance ASSET REGISTER
// (FixedAsset) so HAM/finance can answer: which capitalized assets are actually live on
// the network, which are on the books but never seen (candidate retired/missing), and
// which discovered hardware isn't on the register (candidate un-capitalized).
//
// Read-model, same as the CustomerConfigurationItem bridge (kernel decision DI-56B99A37FA40):
// MOVES NO AUTHORITY, persists nothing. FixedAsset carries no manufacturer/model — only a
// serial — so this matches on serial ONLY, fail-closed: a device with no serial, or an asset
// with no serial, never matches (a false capitalization link is worse than none). FixedAsset
// is org-internal (no customer scope). Pure and fixture-tested; the caller passes loaded rows.

/** Minimal discovered-device shape (serial lives in discovery `properties`). */
export type AssetBridgeInventoryEntity = {
  id: string;
  properties?: Record<string, unknown> | null;
};

/** Minimal finance-asset shape. */
export type AssetBridgeFixedAsset = {
  id: string;
  serialNumber: string | null;
};

export type AssetBridgeMatch = {
  inventoryEntityId: string;
  fixedAssetId: string;
  method: "serial";
  confidence: number;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function entitySerial(entity: AssetBridgeInventoryEntity): string | null {
  const props = entity.properties;
  if (!props) return null;
  for (const k of ["serialNumber", "serial"]) {
    const v = props[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/**
 * Best FixedAsset match for one discovered device, by serial only, or null. Fail-closed:
 * an entity with no serial never matches (returns null before scanning).
 */
export function matchInventoryEntityToAsset(
  entity: AssetBridgeInventoryEntity,
  assets: AssetBridgeFixedAsset[],
): AssetBridgeMatch | null {
  const serial = entitySerial(entity);
  if (!serial) return null;
  const match = assets.find((a) => a.serialNumber && norm(a.serialNumber) === norm(serial));
  return match
    ? { inventoryEntityId: entity.id, fixedAssetId: match.id, method: "serial", confidence: 0.99 }
    : null;
}

export type AssetReconciliation = {
  matches: AssetBridgeMatch[];
  /** Capitalized assets a discovered device corresponds to (live on the network). */
  capitalizedAndDiscovered: number;
  /** Capitalized assets with no discovered device — on the books, not seen (retired/missing/offline). */
  capitalizedNotDiscovered: number;
  /** Serial-carrying discovered devices with no matching asset — candidate un-capitalized hardware. */
  discoveredNotCapitalized: number;
  /** Discovered devices carrying a serial (the population this reconciliation can actually assess). */
  serialBearingDevices: number;
};

/**
 * Reconcile discovered devices against the finance asset register. Only serial-bearing
 * devices are assessable (serial is the sole shared key), so `discoveredNotCapitalized`
 * counts serial-bearing devices with no matching asset — not the whole estate.
 */
export function correlateDiscoveryToAssets(
  entities: AssetBridgeInventoryEntity[],
  assets: AssetBridgeFixedAsset[],
): AssetReconciliation {
  const matches: AssetBridgeMatch[] = [];
  const matchedAssets = new Set<string>();
  let serialBearingDevices = 0;
  let discoveredNotCapitalized = 0;

  for (const entity of entities) {
    if (!entitySerial(entity)) continue; // not assessable — no serial
    serialBearingDevices += 1;
    const match = matchInventoryEntityToAsset(entity, assets);
    if (match) {
      matches.push(match);
      matchedAssets.add(match.fixedAssetId);
    } else {
      discoveredNotCapitalized += 1;
    }
  }

  return {
    matches,
    capitalizedAndDiscovered: matchedAssets.size,
    capitalizedNotDiscovered: assets.length - matchedAssets.size,
    discoveredNotCapitalized,
    serialBearingDevices,
  };
}
