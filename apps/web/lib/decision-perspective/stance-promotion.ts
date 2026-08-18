// Stance-material promotion (EP-0AF96937 stance-onboarding design §5).
//
// The single write path that makes an org stance GATE-LIVE: a WikiPage alone
// is a policy document; only an approved+promoted PerspectiveMaterial row in
// the right domainClass changes what evaluate_org_business_decision allows
// (a documented policy without system enforcement does not change decision
// behavior — design §9). Three authority tiers, from the confirmation ladder:
//
//   unconfirmed  B / 0.6  — archetype default; effective 0.45, clears nothing
//   confirmed    A / 0.9  — owner said so; clears every low-risk class
//   ruled        A / 1.0  — a human ruled on a real decision in this class
//
// Unlike the onboarding seeder (which never upgrades), this module's upsert
// DELIBERATELY sets grade/weight on update — it exists to move material up
// the ladder. It never moves material down: promote() refuses to write a
// lower tier over a higher one.

import { CROSS_DOMAIN_MATERIAL_TAG, type DecisionDomainClass } from "./types";

export const STANCE_TIERS = {
  unconfirmed: { evidenceGrade: "B", confidenceWeight: 0.6 },
  confirmed: { evidenceGrade: "A", confidenceWeight: 0.9 },
  ruled: { evidenceGrade: "A", confidenceWeight: 1.0 },
} as const;

export type StanceTier = keyof typeof STANCE_TIERS;

/** Rank for the never-downgrade guard. */
const TIER_RANK: Record<StanceTier, number> = { unconfirmed: 0, confirmed: 1, ruled: 2 };

function tierOf(row: { evidenceGrade: string; confidenceWeight: number }): StanceTier {
  if (row.evidenceGrade === "A" && row.confidenceWeight >= 1.0) return "ruled";
  if (row.evidenceGrade === "A" && row.confidenceWeight >= 0.9) return "confirmed";
  return "unconfirmed";
}

/**
 * Structural client — satisfied by the real PrismaClient and by test fakes.
 * Method syntax (not property arrows) so PrismaClient's precisely-typed
 * delegates remain assignable under strictFunctionTypes (bivariance),
 * mirroring material.ts's client types.
 */
export type StancePromotionClient = {
  decisionPerspectiveProfile: {
    findFirst(args: unknown): Promise<unknown>;
  };
  perspectiveMaterial: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export type PromoteStanceMaterialInput = {
  db: StancePromotionClient;
  organizationId: string;
  /** The org-overlay stance page backing this material. */
  wikiPageId: string;
  slug: string;
  /** One-line summary used on the material row. */
  summary: string;
  /** The decision classes this stance governs; first is primary. */
  domainClasses: DecisionDomainClass[];
  tier: Exclude<StanceTier, "unconfirmed">;
  sourceType?: "stance" | "principle";
};

export type PromoteStanceMaterialResult =
  | {
      ok: true;
      profileId: string;
      /** materialIds written (or already at an equal/higher tier). */
      materialIds: string[];
      /** materialIds left untouched because they already sat at a higher tier. */
      keptHigherTier: string[];
    }
  | { ok: false; error: "no-org-profile" };

/** materialId scheme shared with seedOrgWwwdCorpus: primary keeps the legacy id. */
export function stanceMaterialId(profileId: string, slug: string, domainClass: string, isPrimary: boolean): string {
  return isPrimary ? `${profileId}:${slug}` : `${profileId}:${slug}:${domainClass}`;
}

/**
 * Upsert the stance's material rows at the given tier across its class bundle.
 * Idempotent; never downgrades (a `ruled` row survives a later `confirmed`
 * write — a real human ruling outranks a settings confirmation).
 */
export async function promoteStanceMaterial(
  input: PromoteStanceMaterialInput,
): Promise<PromoteStanceMaterialResult> {
  const profile = (await input.db.decisionPerspectiveProfile.findFirst({
    where: {
      ownerOrganizationId: input.organizationId,
      kind: "organization",
      status: "active",
    },
    select: { profileId: true, currentVersionId: true },
    orderBy: { createdAt: "asc" },
  })) as { profileId: string; currentVersionId: string | null } | null;

  if (!profile) {
    return { ok: false, error: "no-org-profile" };
  }

  const tier = STANCE_TIERS[input.tier];
  const sourceType = input.sourceType ?? "stance";
  const materialIds: string[] = [];
  const keptHigherTier: string[] = [];

  // BI-F5F2869D. A `ruled` stance is the owner answering a real decision, so it
  // is the one kind of material that must survive re-bucketing: the question it
  // settles can be asked again under a different caller-supplied domainClass,
  // and under the old exact-match gate the ruling would then be invisible — the
  // "remember this" loop taught the corpus something it could never retrieve.
  // Lower tiers stay scoped to their own domain; only an explicit owner ruling
  // earns cross-domain reach.
  const domainTags = (domainClass: string) =>
    input.tier === "ruled"
      ? [domainClass, CROSS_DOMAIN_MATERIAL_TAG]
      : [domainClass];

  for (const [index, domainClass] of input.domainClasses.entries()) {
    const materialId = stanceMaterialId(profile.profileId, input.slug, domainClass, index === 0);
    materialIds.push(materialId);

    const existing = (await input.db.perspectiveMaterial.findUnique({
      where: { materialId },
      select: { evidenceGrade: true, confidenceWeight: true },
    })) as { evidenceGrade: string; confidenceWeight: number } | null;

    if (existing && TIER_RANK[tierOf(existing)] > TIER_RANK[input.tier]) {
      keptHigherTier.push(materialId);
      continue;
    }

    const sourceRef = { wikiPageId: input.wikiPageId, slug: input.slug, organizationId: input.organizationId };
    await input.db.perspectiveMaterial.upsert({
      where: { materialId },
      update: {
        sourceType,
        sourceRef,
        scope: { domains: domainTags(domainClass) },
        domainClass,
        domains: domainTags(domainClass),
        summary: input.summary,
        freshness: "current",
        evidenceGrade: tier.evidenceGrade,
        confidenceWeight: tier.confidenceWeight,
        reviewStatus: "approved",
        promotionState: "promoted",
        lastValidatedAt: new Date(),
      },
      create: {
        materialId,
        profileId: profile.profileId,
        profileVersionId: profile.currentVersionId ?? `${profile.profileId}-v1`,
        sourceType,
        sourceRef,
        scope: { domains: domainTags(domainClass) },
        domainClass,
        direction: "support",
        domains: domainTags(domainClass),
        freshness: "current",
        evidenceGrade: tier.evidenceGrade,
        confidenceWeight: tier.confidenceWeight,
        reviewStatus: "approved",
        promotionState: "promoted",
        summary: input.summary,
        lastValidatedAt: new Date(),
      },
    });
  }

  return { ok: true, profileId: profile.profileId, materialIds, keptHigherTier };
}
