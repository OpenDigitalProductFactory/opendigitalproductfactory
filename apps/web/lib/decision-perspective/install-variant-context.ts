// apps/web/lib/decision-perspective/install-variant-context.ts
// WSID archetype/region axis — resolve the install's variant context (which
// business archetype + region this install is) ONCE, shared by the runtime
// corpus retrieval (agent-coworker) and the operator surfaces so they agree on
// which corpus slice each coworker is served. Fail-open: any error → {} (no
// variant filtering, full corpus preserved).

import { isProfessionArchetype } from "@dpf/db/wiki-taxonomy";
import type { ProfessionCorpusInstallContext } from "./profession-corpus";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type InstallVariantClient = {
  storefrontConfig: {
    findFirst(args: {
      select: { archetype: { select: { category: true } } };
    }): Promise<{ archetype: { category: string } | null } | null>;
  };
};

/**
 * Resolve the install's archetype (from the storefront's archetype category,
 * already a PROFESSION_ARCHETYPES slug) and regional profile. The multi-set
 * regional profile (operatesIn / sellsTo / employsIn / dataResidency) is NOT yet
 * a first-class install setting, so it resolves empty — every jurisdiction-
 * specific page stays eligible (no regression) until setup captures the
 * business's operating / selling / employing jurisdictions.
 */
export async function resolveInstallVariantContext(
  db: InstallVariantClient,
): Promise<ProfessionCorpusInstallContext> {
  try {
    const sf = await db.storefrontConfig.findFirst({
      select: { archetype: { select: { category: true } } },
    });
    const category = sf?.archetype?.category ?? null;
    return {
      archetype: category && isProfessionArchetype(category) ? category : null,
      regional: {},
    };
  } catch {
    return {};
  }
}
