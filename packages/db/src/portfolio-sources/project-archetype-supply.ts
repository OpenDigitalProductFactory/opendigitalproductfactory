// Archetype supplier/goods projector (BI-PORTCOV-P5; spec §4.4.5).
//
// Per-org, authoritative source: read the org's chosen archetype, look up its
// category's starter suppliers/goods, and project them as portfolio entries —
// suppliers into Manufacturing & Delivery (the supply chain managed to deliver,
// coverage=used), goods into Goods and Services for Sale (distinct from services,
// coverage=sold). Reuses the projectPortfolioEntries writer so coverage/source
// markers and non-destructive behaviour are identical to the other projectors.
// Idempotent and editable: re-running never clobbers operator-refined rows.
//
// Called at onboarding completion alongside seedMarketOffer (apps/web
// setup-progress finalizeSetupCompletion).

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import { prisma } from "../client";
import { ARCHETYPE_SUPPLY_MANIFEST } from "./archetype-supply-manifest";
import {
  projectPortfolioEntries,
  type ProjectPortfolioClient,
  type ProjectPortfolioResult,
} from "./project-portfolio-source";
import type { ProjectedPortfolioEntry } from "./types";

/** Structural client — the writer client plus the storefrontConfig read. */
export type ProjectArchetypeSupplyClient = ProjectPortfolioClient & {
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
};

export type ProjectArchetypeSupplyInput = {
  organizationId: string;
  db?: ProjectArchetypeSupplyClient;
};

export type ProjectArchetypeSupplyResult = ProjectPortfolioResult & {
  /** The archetype that drove the projection, or null when none is set. */
  archetypeId: string | null;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const EMPTY = { total: 0, created: 0, updated: 0, skipped: 0 } as const;

/**
 * Project the org's archetype-implied suppliers + goods into the portfolio.
 * No-op (archetypeId echoed) when the org has no archetype or the archetype's
 * category has no starter manifest.
 */
export async function projectArchetypeSupply(
  input: ProjectArchetypeSupplyInput,
): Promise<ProjectArchetypeSupplyResult> {
  const db = input.db ?? (prisma as unknown as ProjectArchetypeSupplyClient);

  const sf = (await db.storefrontConfig.findFirst({
    where: { organizationId: input.organizationId },
    select: { archetypeId: true },
  })) as { archetypeId: string | null } | null;

  const archetypeId = sf?.archetypeId ?? null;
  if (!archetypeId) return { ...EMPTY, archetypeId: null };

  const def = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  const starter = def ? ARCHETYPE_SUPPLY_MANIFEST[def.category] : undefined;
  if (!starter) return { ...EMPTY, archetypeId };

  const entries: ProjectedPortfolioEntry[] = [
    ...starter.suppliers.map((s) => ({
      productId: `sup-${input.organizationId}-${slugify(s.name)}`,
      name: s.name,
      description: `${s.description} (archetype-seeded starter; refine as suppliers are confirmed).`,
      portfolioSlug: "manufacturing_and_delivery" as const,
      taxonomyNodeId: null,
      coverageStatus: "used" as const,
      sourceKind: "archetype" as const,
    })),
    ...starter.goods.map((g) => ({
      productId: `good-${input.organizationId}-${slugify(g.name)}`,
      name: g.name,
      description: `${g.description} (archetype-seeded starter; refine as the catalog evolves).`,
      portfolioSlug: "products_and_services_sold" as const,
      taxonomyNodeId: null,
      coverageStatus: "sold" as const,
      sourceKind: "archetype" as const,
    })),
  ];

  const result = await projectPortfolioEntries(entries, { db });
  return { ...result, archetypeId };
}
