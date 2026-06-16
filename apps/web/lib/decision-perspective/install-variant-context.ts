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
 * already a PROFESSION_ARCHETYPES slug) and region. Region is not yet a
 * first-class install setting, so `jurisdiction` stays `null` (unfiltered) until
 * setup notation captures it.
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
      jurisdiction: null,
    };
  } catch {
    return {};
  }
}
