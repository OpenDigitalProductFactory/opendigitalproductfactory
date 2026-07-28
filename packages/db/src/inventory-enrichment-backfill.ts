// One-shot backfill for InventoryEntity enrichment.
//
// On an existing install the discovery sync only re-enriches entities
// that get touched by the next sweep. Stale-only entities (Docker
// containers we no longer have a live source for, hosts we saw once)
// would stay unenriched forever without a backfill pass. This script
// walks every InventoryEntity, applies `deriveInventoryEnrichment`, and
// writes the diff. Idempotent — running it twice on an already-enriched
// install is a no-op.

import { prisma } from "./client";
import { buildEnrichmentUpdate, deriveInventoryEnrichment } from "./inventory-enrichment";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

export type BackfillReport = {
  scanned: number;
  updated: number;
  skipped: number;
  byField: {
    manufacturer: number;
    productModel: number;
    observedVersion: number;
    normalizedVersion: number;
    iconKey: number;
    supportStatus: number;
  };
};

export async function backfillInventoryEnrichment(): Promise<BackfillReport> {
  const entities = await prisma.inventoryEntity.findMany({
    where: INVENTORY_ENTITY_CANONICAL_WHERE,
    select: {
      id: true,
      entityType: true,
      name: true,
      manufacturer: true,
      productModel: true,
      observedVersion: true,
      normalizedVersion: true,
      iconKey: true,
      supportStatus: true,
      properties: true,
    },
  });

  const report: BackfillReport = {
    scanned: entities.length,
    updated: 0,
    skipped: 0,
    byField: {
      manufacturer: 0,
      productModel: 0,
      observedVersion: 0,
      normalizedVersion: 0,
      iconKey: 0,
      supportStatus: 0,
    },
  };

  for (const entity of entities) {
    const enrichment = deriveInventoryEnrichment({
      entityType: entity.entityType,
      name: entity.name,
      manufacturer: entity.manufacturer,
      productModel: entity.productModel,
      observedVersion: entity.observedVersion,
      normalizedVersion: entity.normalizedVersion,
      iconKey: entity.iconKey,
      supportStatus: entity.supportStatus,
      properties: entity.properties,
    });

    const update = buildEnrichmentUpdate(entity, enrichment);
    if (!update) {
      report.skipped += 1;
      continue;
    }

    if (update.manufacturer !== undefined) report.byField.manufacturer += 1;
    if (update.productModel !== undefined) report.byField.productModel += 1;
    if (update.observedVersion !== undefined) report.byField.observedVersion += 1;
    if (update.normalizedVersion !== undefined) report.byField.normalizedVersion += 1;
    if (update.iconKey !== undefined) report.byField.iconKey += 1;
    if (update.supportStatus !== undefined) report.byField.supportStatus += 1;

    await prisma.inventoryEntity.update({ where: { id: entity.id }, data: update });
    report.updated += 1;
  }

  // Second pass: merge enrichment between sibling entities that share a
  // MAC. Network discovery often produces two rows per device — one
  // `host` (rich properties incl. OUI vendor) and one `network_client`
  // (minimal properties). Auto-product attribution may pick either, so
  // we copy manufacturer/iconKey/supportStatus from whichever sibling
  // has it onto the one that doesn't.
  const merged = await mergeMacSiblings();
  report.updated += merged;
  return report;
}

async function mergeMacSiblings(): Promise<number> {
  type SiblingRow = {
    id: string;
    name: string;
    manufacturer: string | null;
    iconKey: string | null;
    supportStatus: string;
    observedVersion: string | null;
    normalizedVersion: string | null;
    properties: unknown;
  };

  const rows = await prisma.inventoryEntity.findMany({
    where: INVENTORY_ENTITY_CANONICAL_WHERE,
    select: {
      id: true,
      name: true,
      manufacturer: true,
      iconKey: true,
      supportStatus: true,
      observedVersion: true,
      normalizedVersion: true,
      properties: true,
    },
  });

  const byMac = new Map<string, SiblingRow[]>();
  for (const row of rows) {
    const props = row.properties as Record<string, unknown> | null;
    const mac = props && typeof props === "object" && typeof props.mac === "string" ? props.mac : null;
    if (!mac) continue;
    const key = mac.toLowerCase();
    if (!byMac.has(key)) byMac.set(key, []);
    byMac.get(key)!.push(row as SiblingRow);
  }

  let updated = 0;
  for (const siblings of byMac.values()) {
    if (siblings.length < 2) continue;
    // Best-of for each field across the siblings.
    const best = {
      manufacturer: siblings.find((s) => s.manufacturer)?.manufacturer ?? null,
      iconKey: siblings.find((s) => s.iconKey)?.iconKey ?? null,
      supportStatus: siblings.find((s) => s.supportStatus !== "unknown")?.supportStatus ?? null,
      observedVersion: siblings.find((s) => s.observedVersion)?.observedVersion ?? null,
      normalizedVersion: siblings.find((s) => s.normalizedVersion)?.normalizedVersion ?? null,
    };

    for (const sibling of siblings) {
      const patch: Record<string, string> = {};
      if (!sibling.manufacturer && best.manufacturer) patch.manufacturer = best.manufacturer;
      if (!sibling.iconKey && best.iconKey) patch.iconKey = best.iconKey;
      if (sibling.supportStatus === "unknown" && best.supportStatus) patch.supportStatus = best.supportStatus;
      if (!sibling.observedVersion && best.observedVersion) patch.observedVersion = best.observedVersion;
      if (!sibling.normalizedVersion && best.normalizedVersion) patch.normalizedVersion = best.normalizedVersion;
      if (Object.keys(patch).length > 0) {
        await prisma.inventoryEntity.update({ where: { id: sibling.id }, data: patch });
        updated += 1;
      }
    }
  }
  return updated;
}

// Allow running directly: `pnpm --filter @dpf/db tsx src/inventory-enrichment-backfill.ts`
if (require.main === module) {
  backfillInventoryEnrichment()
    .then((report) => {
      console.log("Inventory enrichment backfill complete:");
      console.log(JSON.stringify(report, null, 2));
      return prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error("Backfill failed:", error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
