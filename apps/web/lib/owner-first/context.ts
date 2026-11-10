// apps/web/lib/owner-first/context.ts
//
// Shared loader for the archetype context the owner-first summaries need. The
// domain pages (customer, employee, finance) did not previously read the
// storefront archetype, so each would otherwise hand-roll the same query. One
// cached read keeps the summaries archetype-aware without four divergent copies.

import { prisma } from "@dpf/db";
import { resolveOwnerVocabulary, type OwnerDomainVocabulary } from "./vocabulary";

export type OwnerFirstContext = {
  archetypeCategory: string | null;
  archetypeId: string | null;
  archetypeName: string | null;
  vocab: OwnerDomainVocabulary;
};

export async function loadOwnerFirstContext(): Promise<OwnerFirstContext> {
  const config = await prisma.storefrontConfig.findFirst({
    include: { archetype: { select: { category: true, archetypeId: true, name: true } } },
  });
  const category = config?.archetype?.category ?? null;
  const archetypeId = config?.archetype?.archetypeId ?? null;
  return {
    archetypeCategory: category,
    archetypeId,
    archetypeName: config?.archetype?.name ?? null,
    vocab: resolveOwnerVocabulary(category, archetypeId),
  };
}
