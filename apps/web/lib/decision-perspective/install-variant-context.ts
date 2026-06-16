// apps/web/lib/decision-perspective/install-variant-context.ts
// WSID archetype/region axis — resolve the install's variant context (which
// business archetype it is, and its multi-dimensional regional/compliance
// profile) ONCE, shared by the runtime corpus retrieval (agent-coworker) and the
// operator surfaces so they agree on which corpus slice each coworker is served.
// Fail-open: any read failure degrades to no filtering on that dimension.

import { isProfessionArchetype } from "@dpf/db/wiki-taxonomy";
import type { ProfessionCorpusInstallContext } from "./profession-corpus";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type InstallVariantClient = {
  storefrontConfig: {
    findFirst(args: {
      select: { archetype: { select: { category: true } } };
    }): Promise<{ archetype: { category: string } | null } | null>;
  };
  businessContext: {
    findFirst(args: {
      select: { operatesIn: true; sellsTo: true; employsIn: true; dataResidency: true };
    }): Promise<{
      operatesIn: string[];
      sellsTo: string[];
      employsIn: string[];
      dataResidency: string[];
    } | null>;
  };
};

/** Run a read, degrading to null on any failure (incl. a synchronous throw from a partial mock). */
function safeRead<T>(fn: () => Promise<T>): Promise<T | null> {
  return Promise.resolve()
    .then(fn)
    .catch(() => null);
}

/**
 * Resolve the install's archetype (from the storefront's archetype category,
 * already a PROFESSION_ARCHETYPES slug) and its regional profile (the operating /
 * selling / employing / data-residency jurisdiction sets captured at setup on
 * BusinessContext). The jurisdiction-basis model matches each corpus page's
 * basis against the corresponding set; an empty/undeclared set is not filtered.
 */
export async function resolveInstallVariantContext(
  db: InstallVariantClient,
): Promise<ProfessionCorpusInstallContext> {
  const [sf, bc] = await Promise.all([
    safeRead(() => db.storefrontConfig.findFirst({ select: { archetype: { select: { category: true } } } })),
    safeRead(() =>
      db.businessContext.findFirst({
        select: { operatesIn: true, sellsTo: true, employsIn: true, dataResidency: true },
      }),
    ),
  ]);

  const category = sf?.archetype?.category ?? null;
  return {
    archetype: category && isProfessionArchetype(category) ? category : null,
    regional: {
      operatesIn: bc?.operatesIn ?? [],
      sellsTo: bc?.sellsTo ?? [],
      employsIn: bc?.employsIn ?? [],
      dataResidency: bc?.dataResidency ?? [],
    },
  };
}
