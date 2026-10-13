import { prisma } from "@dpf/db";
import { projectOperationalValueStreamForArchetype } from "./project-operational-value-stream";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * Boot backfill for the operational value stream (OVSM) EA view.
 *
 * The OVSM is derived + projected into the EA substrate only at storefront
 * setup and on archetype-reset (see project-operational-value-stream.ts, landed
 * in #1798 on 2026-06-13). An install that completed storefront setup BEFORE
 * that generator was running on it — or that adopts the generator on a later
 * upgrade — therefore has a StorefrontConfig + archetype but no
 * `archetype_value_stream` EaView, so `/ea/value-streams` shows the empty
 * "No value-stream view generated yet." state forever. Nothing self-heals it.
 *
 * This reconciler closes that gap on boot, mirroring the other boot reconcilers
 * in instrumentation.ts. Every StorefrontConfig runs the same idempotent
 * projection setup uses: an existing diagram cannot prove its rooms are present
 * or current. It is non-fatal per org — an archetype with no
 * template OVSM derivation, or a missing EA seed, is logged and skipped rather
 * than failing boot.
 *
 * scopeRef matches projectArchetypeValueStream's `${orgId}:operational` key.
 */

const ARCHETYPE_VALUE_STREAM_SCOPE = "archetype_value_stream";

function operationalScopeRef(orgId: string): string {
  return `${orgId}:operational`;
}

export async function backfillOperationalValueStreamsOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<{ created: number; present: number; skipped: number } | null> {
  try {
    const configs = await prisma.storefrontConfig.findMany({
      select: { organizationId: true, archetypeId: true },
    });

    let created = 0;
    let present = 0;
    let skipped = 0;

    for (const config of configs) {
      // Existence distinguishes creation from reconciliation, not eligibility.
      const existing = await prisma.eaView.findFirst({
        where: {
          scopeType: ARCHETYPE_VALUE_STREAM_SCOPE,
          scopeRef: operationalScopeRef(config.organizationId),
        },
        select: { id: true },
      });

      // StorefrontConfig.archetypeId is the DB id; the projection resolves the
      // template by the stable slug (StorefrontArchetype.archetypeId).
      const archetype = await prisma.storefrontArchetype.findUnique({
        where: { id: config.archetypeId },
        select: { archetypeId: true },
      });
      if (!archetype) {
        skipped++;
        logger.warn(
          `[ovsm-backfill] org ${config.organizationId}: archetype row ${config.archetypeId} not found — skipping`,
        );
        continue;
      }

      try {
        const result = await projectOperationalValueStreamForArchetype({
          organizationId: config.organizationId,
          archetypeId: archetype.archetypeId,
        });
        if (existing) present++;
        else created++;
        logger.log(
          `[ovsm-backfill] org ${config.organizationId} (${archetype.archetypeId}): reconciled value-stream view ${result.viewId} (${result.createdElements} new elements) and room definitions`,
        );
      } catch (err) {
        // A missing template OVSM derivation or unseeded EA notation/types must
        // not crash boot — log loudly and move on (the next boot retries).
        skipped++;
        const msg = getErrorMessage(err);
        logger.warn(
          `[ovsm-backfill] org ${config.organizationId} (${archetype.archetypeId}): projection failed — ${msg}`,
        );
      }
    }

    if (created || skipped) {
      logger.log(
        `[ovsm-backfill] ${created} created, ${present} already present, ${skipped} skipped`,
      );
    }
    return { created, present, skipped };
  } catch (err) {
    logger.error("[ovsm-backfill] failed (non-fatal):", err);
    return null;
  }
}
