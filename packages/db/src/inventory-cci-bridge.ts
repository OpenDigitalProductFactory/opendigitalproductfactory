// InventoryEntity ↔ CustomerConfigurationItem bridge (BI-828998DC, HAM Phase D2, spec §7).
//
// Correlates DISCOVERED devices (InventoryEntity) with MANAGED customer equipment
// (CustomerConfigurationItem) for the customer-estate view — "which managed CIs do we
// actually see in discovery, and which discovered devices aren't managed CIs (shadow)?".
//
// This is a READ-MODEL match (kernel decision DI-56B99A37FA40): it MOVES NO AUTHORITY and
// persists nothing. Discovery does not collect serial/asset-tag today, so most matches are
// model-level and confidence-scored — never asserted as an authoritative link. Persisting a
// confirmed link (a link table + human confirmation) is the deliberate D2 follow-up. Pure
// and fixture-tested; the caller passes already-loaded, same-account rows.

/** Minimal discovered-device shape the matcher needs. */
export type BridgeInventoryEntity = {
  id: string;
  manufacturer: string | null;
  productModel: string | null;
  name: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  /** Discovery `properties` — may carry serialNumber / assetTag when a collector supplies them. */
  properties?: Record<string, unknown> | null;
};

/** Minimal managed-CI shape the matcher needs. */
export type BridgeConfigurationItem = {
  id: string;
  accountId: string;
  siteId: string | null;
  manufacturer: string | null;
  vendorName: string | null;
  productModel: string | null;
  productName: string | null;
  serialNumber: string | null;
  assetTag: string | null;
};

/** How a discovered device was matched to a managed CI — strongest first. */
export type BridgeMatchMethod = "serial" | "asset_tag" | "model";

export type BridgeMatch = {
  inventoryEntityId: string;
  configurationItemId: string;
  method: BridgeMatchMethod;
  confidence: number;
};

const CONFIDENCE: Record<BridgeMatchMethod, number> = {
  serial: 0.99,
  asset_tag: 0.95,
  model: 0.8,
};

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function propString(props: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!props) return null;
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** True when the two rows can legally be the same physical asset: same account, and — when
 *  BOTH name a site — the same site. A missing site on either side allows an account-level
 *  match (a discovered device not yet site-attributed can still be a managed CI). */
function scopeCompatible(entity: BridgeInventoryEntity, cci: BridgeConfigurationItem): boolean {
  if (entity.customerAccountId === null || entity.customerAccountId !== cci.accountId) return false;
  if (entity.customerSiteId && cci.siteId && entity.customerSiteId !== cci.siteId) return false;
  return true;
}

/**
 * Best match for one discovered device among a set of managed CIs, or null. Precedence:
 * serial (exact) → asset tag (exact) → manufacturer+model (normalized). Weaker-than-model
 * signals do NOT match — a false link is worse than an unmatched device (fail-closed).
 * Never crosses customer/site scope.
 */
export function matchInventoryEntityToCci(
  entity: BridgeInventoryEntity,
  ccis: BridgeConfigurationItem[],
): BridgeMatch | null {
  const candidates = ccis.filter((c) => scopeCompatible(entity, c));
  if (candidates.length === 0) return null;

  const entitySerial = propString(entity.properties, "serialNumber", "serial");
  const entityAssetTag = propString(entity.properties, "assetTag", "asset_tag");
  const entityVendor = norm(entity.manufacturer);
  const entityModel = norm(entity.productModel) || norm(entity.name);

  const make = (cci: BridgeConfigurationItem, method: BridgeMatchMethod): BridgeMatch => ({
    inventoryEntityId: entity.id,
    configurationItemId: cci.id,
    method,
    confidence: CONFIDENCE[method],
  });

  if (entitySerial) {
    const bySerial = candidates.find((c) => c.serialNumber && norm(c.serialNumber) === norm(entitySerial));
    if (bySerial) return make(bySerial, "serial");
  }
  if (entityAssetTag) {
    const byTag = candidates.find((c) => c.assetTag && norm(c.assetTag) === norm(entityAssetTag));
    if (byTag) return make(byTag, "asset_tag");
  }
  if (entityVendor && entityModel) {
    const byModel = candidates.find((c) => {
      const cciVendor = norm(c.manufacturer) || norm(c.vendorName);
      const cciModel = norm(c.productModel) || norm(c.productName);
      return cciVendor === entityVendor && cciModel !== "" && (cciModel === entityModel || entityModel.includes(cciModel) || cciModel.includes(entityModel));
    });
    if (byModel) return make(byModel, "model");
  }
  return null;
}

export type EstateCorrelation = {
  matches: BridgeMatch[];
  /** Managed CIs that a discovered device corresponds to. */
  managedAndDiscovered: number;
  /** Managed CIs with no discovered device — undiscovered / offline / out-of-scope. */
  managedNotDiscovered: number;
  /** Discovered devices with no managed CI — shadow / unmanaged estate. */
  discoveredNotManaged: number;
};

/**
 * Correlate a customer account's discovered devices with its managed CIs. Each discovered
 * device claims at most one CI (its best match); each CI is counted discovered once any
 * device matches it. Read-only — the caller decides what to surface.
 */
export function correlateDiscoveryToEstate(
  entities: BridgeInventoryEntity[],
  ccis: BridgeConfigurationItem[],
): EstateCorrelation {
  const matches: BridgeMatch[] = [];
  const matchedCcis = new Set<string>();
  let discoveredNotManaged = 0;

  for (const entity of entities) {
    const match = matchInventoryEntityToCci(entity, ccis);
    if (match) {
      matches.push(match);
      matchedCcis.add(match.configurationItemId);
    } else {
      discoveredNotManaged += 1;
    }
  }

  return {
    matches,
    managedAndDiscovered: matchedCcis.size,
    managedNotDiscovered: ccis.length - matchedCcis.size,
    discoveredNotManaged,
  };
}
