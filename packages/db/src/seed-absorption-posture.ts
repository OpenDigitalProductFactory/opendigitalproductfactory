// Seed the absorption posture matrix (BI-BF909CE6, P1).
//
// Plan: docs/superpowers/plans/2026-07-24-absorption-posture-matrix-vertical-provider-seed.md §4 P1.
//
// Idempotent AND non-clobbering: it inserts a conservative default posture for
// every P0 inventory provider, but NEVER overwrites a verdict a human/operator
// has authored. A row is refreshed only while it is still seed-owned
// (source=seed AND status=proposed); once someone confirms or edits it, the
// seed leaves it untouched (plan §5 governance — no verdict reaches confirmed
// without human action, and the seed must not undo that).

import type { PrismaClient } from "../generated/client/client";
import { buildAbsorptionPostureSeedRows } from "./portfolio-sources/absorption-posture.js";

export interface AbsorptionPostureSeedResult {
  created: number;
  refreshed: number;
  preserved: number;
}

export async function seedAbsorptionPosture(
  prisma: PrismaClient,
): Promise<AbsorptionPostureSeedResult> {
  const rows = buildAbsorptionPostureSeedRows();
  const result: AbsorptionPostureSeedResult = { created: 0, refreshed: 0, preserved: 0 };

  for (const row of rows) {
    const existing = await prisma.absorptionPosture.findUnique({
      where: { postureId: row.postureId },
      select: { id: true, source: true, status: true },
    });

    if (!existing) {
      await prisma.absorptionPosture.create({
        data: {
          postureId: row.postureId,
          providerName: row.providerName,
          integrationCategory: row.integrationCategory,
          connectorTier: row.connectorTier,
          archetypeIds: row.archetypeIds,
          verdict: row.verdict,
          reason: row.reason,
          confidence: row.confidence,
          source: row.source,
          status: row.status,
        },
      });
      result.created += 1;
      continue;
    }

    // Preserve anything a human/operator/coworker has touched.
    const seedOwned = existing.source === "seed" && existing.status === "proposed";
    if (!seedOwned) {
      result.preserved += 1;
      continue;
    }

    // Still seed-owned: refresh the derived fields so a manifest correction
    // (new archetype, re-tiered category) propagates without disturbing edits.
    await prisma.absorptionPosture.update({
      where: { postureId: row.postureId },
      data: {
        providerName: row.providerName,
        integrationCategory: row.integrationCategory,
        connectorTier: row.connectorTier,
        archetypeIds: row.archetypeIds,
        verdict: row.verdict,
        reason: row.reason,
        confidence: row.confidence,
      },
    });
    result.refreshed += 1;
  }

  return result;
}
