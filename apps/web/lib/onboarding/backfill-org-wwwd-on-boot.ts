// Boot backfill for the org WWWD corpus (BI-44526F3E Phase A).
//
// The WWWD seed chain (seed-org-wwwd-corpus.ts + siblings) runs only inside
// finalizeSetupCompletion — i.e. once, at the moment initial setup completes.
// Any install that completed setup BEFORE those seeders shipped (or where the
// fail-open chain failed silently) therefore has an org with NO overlay wiki
// pages and NO org-perspective-* DecisionPerspectiveProfile: the Decision
// Governance hub shows "no stance of your own yet" forever, and
// evaluate_org_business_decision falls back to platform doctrine on every
// call. Nothing self-heals it — the 2026-07-06 review found the reference
// install in exactly this state.
//
// This reconciler closes that gap on boot, mirroring the other boot
// reconcilers in instrumentation.ts (see backfillOperationalValueStreamsOnBoot).
// For every organization that has actually completed setup, if the org's WWWD
// profile or overlay pages are missing it re-runs the SAME idempotent seed
// chain setup-completion uses. Cheap when already present (two existence
// queries per org, no writes) and non-fatal per org.

import { prisma } from "@dpf/db";
import { resolveOrgProfileId } from "@/lib/decision-perspective/material";
import { STANCE_VECTOR_KEYS } from "./archetype-business-context";
import { stanceVectorSlug } from "./seed-org-wwwd-corpus";
import { runSetupCompletionSeeds } from "./setup-completion-seeds";

export type BackfillOrgWwwdResult = {
  seeded: number;
  present: number;
  skipped: number;
};

/**
 * An org is eligible for backfill when setup genuinely finished: either a
 * completed PlatformSetupProgress row exists (the normal marker), or — for
 * installs old enough to predate that linkage — the storefront + business
 * context rows that setup produces are both present.
 */
async function hasCompletedSetup(organizationId: string): Promise<boolean> {
  const completed = await prisma.platformSetupProgress.findFirst({
    where: {
      completedAt: { not: null },
      OR: [{ organizationId }, { organizationId: null }],
    },
    select: { id: true },
  });
  if (completed) return true;

  const [storefront, businessContext] = await Promise.all([
    prisma.storefrontConfig.findFirst({ select: { id: true } }),
    prisma.businessContext.findUnique({
      where: { organizationId },
      select: { organizationId: true },
    }),
  ]);
  return Boolean(storefront && businessContext);
}

export async function backfillOrgWwwdOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<BackfillOrgWwwdResult | null> {
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true } });

    const result: BackfillOrgWwwdResult = { seeded: 0, present: 0, skipped: 0 };

    for (const org of orgs) {
      try {
        // Cheap presence check — a healthy install does no seed work on boot.
        // Shape-aware (BI-70ADC71F): "present" means the profile exists AND
        // the corpus carries the current shape (all 5 stance-vector pages).
        // Installs seeded before the stance-vector redistribution re-run the
        // idempotent chain once — it adds the missing pages/materials, retags
        // org-supply-chain, and never downgrades an owner-confirmed material.
        const vectorSlugs = STANCE_VECTOR_KEYS.map((key) => stanceVectorSlug(key));
        const [profileId, overlayPageCount, vectorPageCount] = await Promise.all([
          resolveOrgProfileId({ db: prisma, organizationId: org.id }),
          prisma.wikiPage.count({ where: { organizationId: org.id } }),
          prisma.wikiPage.count({
            where: { organizationId: org.id, slug: { in: vectorSlugs } },
          }),
        ]);
        if (profileId && overlayPageCount > 0 && vectorPageCount >= vectorSlugs.length) {
          result.present++;
          continue;
        }

        if (!(await hasCompletedSetup(org.id))) {
          // Mid-setup or bootstrap-only org — completion will run the chain.
          result.skipped++;
          continue;
        }

        await runSetupCompletionSeeds(org.id);
        result.seeded++;
        logger.log(
          `[wwwd-backfill] org ${org.id}: seeded WWWD corpus + profile (was profile=${profileId ?? "none"}, overlayPages=${overlayPageCount}, vectorPages=${vectorPageCount})`,
        );
      } catch (err) {
        result.skipped++;
        logger.warn(`[wwwd-backfill] org ${org.id}: seed failed (non-fatal):`, err);
      }
    }

    if (result.seeded > 0 || result.skipped > 0) {
      logger.log(
        `[wwwd-backfill] done: ${result.seeded} seeded, ${result.present} present, ${result.skipped} skipped`,
      );
    }
    return result;
  } catch (err) {
    logger.error("[wwwd-backfill] failed (non-fatal):", err);
    return null;
  }
}
