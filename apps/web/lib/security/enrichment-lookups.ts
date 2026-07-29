// EP-SOVEREIGN-SOC P1 content — real (prisma-backed) enrichment lookups.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.2.
//
// Wires the injectable enrichment interface (enrichment.ts) to live data:
//   • asset context  ← InventoryEntity (by device hostname/name)
//   • threat intel   ← ThreatIndicator (active-window IOC index)
// The indicator index is loaded once per call; pass the result to
// enrichSecurityEvent. SOC coworkers use this when investigating a detection.

import type { EnrichmentLookups } from "./enrichment";
import {
  buildIndicatorIndex,
  matchIndicatorValues,
  type ThreatIndicatorView,
} from "./threat-intel";

/** Build prisma-backed enrichment lookups (asset + threat intel). The active
 *  ThreatIndicator set is preloaded into an index for O(1) observable matching. */
export async function buildPrismaEnrichmentLookups(): Promise<EnrichmentLookups> {
  const { INVENTORY_ENTITY_CANONICAL_WHERE, prisma } = await import("@dpf/db");
  const now = new Date();
  const indicators = await prisma.threatIndicator.findMany({
    where: { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    select: {
      indicatorKey: true,
      indicatorType: true,
      value: true,
      source: true,
      confidence: true,
      severity: true,
      validFrom: true,
      validUntil: true,
    },
  });
  const index = buildIndicatorIndex(indicators as ThreatIndicatorView[], now);

  return {
    lookupAsset: async (deviceKey: string) => {
      const ent = await prisma.inventoryEntity.findFirst({
        where: { ...INVENTORY_ENTITY_CANONICAL_WHERE, name: deviceKey },
        select: { id: true, name: true, supportStatus: true },
      });
      return ent
        ? { inventoryEntityId: ent.id, name: ent.name, criticality: ent.supportStatus ?? undefined }
        : null;
    },
    matchIndicators: async (values: string[]) => matchIndicatorValues(values, index),
  };
}
