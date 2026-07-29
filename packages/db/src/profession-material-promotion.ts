// Profession craft-material promotion (WSID Phase 6, BI-3B02FF9C).
//
// The WSID sibling of the org stance promotion in
// apps/web/lib/decision-perspective/stance-promotion.ts: a profession corpus
// WikiPage alone is a body-of-knowledge document; only an approved+promoted
// PerspectiveMaterial row on the profession's wsid-<professionKey> profile in
// the right domainClass changes what the profession decision gate
// (evaluateProfessionDecisionGate) can confirm. Until this write path existed,
// every wsid-* profile had ZERO material rows and every craft consult
// deferred — the demand signal seedProfessionProfiles deliberately created.
//
// Three authority tiers, aligned with the stance confirmation ladder
// (2026-06-09 WSID spec §4.6 + the stance-onboarding design §5):
//
//   derived    B / 0.6  — platform-seeded distillation of a standard; DPF's
//                          *reading* of DMBOK/TOGAF/GAAP, not first-party fact
//   confirmed  A / 0.9  — the org's owner published a craft override
//   ruled      A / 1.0  — a human ruled on a real decision in this class
//
// Never downgrades: a ruled row survives a later confirmed write, a confirmed
// row survives a later derived re-seed, and an approved review status is never
// pulled back to draft by a re-run.
//
// Risk tiering (competence-flywheel design §5.5, BI-BE9C95D9): high-stakes
// families — those whose registry contextSlugs touch finance or compliance —
// do NOT get gate-live material from an unattended platform seed. Their
// derived-tier rows land as reviewStatus "draft" / promotionState "candidate",
// visible for audit but invisible to the gate (which requires
// approved+promoted), until a human approves them. Confirmed/ruled tiers are
// human actions by definition and go gate-live everywhere.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Profession material only ever occupies these two decision classes. The
// closed platform registry lives in apps/web/lib/decision-perspective/types.ts
// (DECISION_DOMAIN_CLASSES); this local subset exists because packages/db
// cannot import from apps/web (same precedent: PLAN_READINESS_DOMAIN_CLASS in
// seed-decision-perspective.ts).
export const PROFESSION_DOMAIN_CLASSES = ["professional-practice", "architecture-tradeoff"] as const;
export type ProfessionDomainClass = (typeof PROFESSION_DOMAIN_CLASSES)[number];

export const PROFESSION_MATERIAL_TIERS = {
  derived: { evidenceGrade: "B", confidenceWeight: 0.6 },
  confirmed: { evidenceGrade: "A", confidenceWeight: 0.9 },
  ruled: { evidenceGrade: "A", confidenceWeight: 1.0 },
} as const;

export type ProfessionMaterialTier = keyof typeof PROFESSION_MATERIAL_TIERS;

/** Rank for the never-downgrade guard. */
const TIER_RANK: Record<ProfessionMaterialTier, number> = { derived: 0, confirmed: 1, ruled: 2 };

function tierOf(row: { evidenceGrade: string; confidenceWeight: number }): ProfessionMaterialTier {
  if (row.evidenceGrade === "A" && row.confidenceWeight >= 1.0) return "ruled";
  if (row.evidenceGrade === "A" && row.confidenceWeight >= 0.9) return "confirmed";
  return "derived";
}

/**
 * The decision-bearing subset of the corpus (WSID spec §4.6): pages that
 * encode rules, trade-off heuristics, positions, or recorded decisions.
 * Context kinds (entity, summary, runbook) stay retrieval-only — they ground
 * prompts, not gate verdicts.
 */
export const DECISION_BEARING_PAGE_KINDS = ["principle", "heuristic", "stance", "decision"] as const;

export function isDecisionBearingPageKind(pageKind: string): boolean {
  return (DECISION_BEARING_PAGE_KINDS as readonly string[]).includes(pageKind);
}

/**
 * High-stakes families require human approval before platform-seeded material
 * goes gate-live (competence-flywheel §5.5 names legal, compliance, finance,
 * healthcare). Derived from the registry's contextSlugs rather than a
 * hardcoded family list so a new regulated family inherits the hold
 * automatically: finance + legal-compliance + hr-people-ops + security all
 * carry one of these slugs today.
 */
export const HIGH_STAKES_CONTEXT_SLUGS = ["finance", "compliance"] as const;

export function isHighStakesProfession(contextSlugs: readonly string[]): boolean {
  return contextSlugs.some((slug) =>
    (HIGH_STAKES_CONTEXT_SLUGS as readonly string[]).includes(slug),
  );
}

/**
 * Which decision classes a profession's craft material occupies; the first
 * entry is the primary class (its material row keeps the short id). Every
 * family governs `professional-practice`; enterprise-architecture review and
 * practice doctrine additionally answers `architecture-tradeoff` consults —
 * the class whose 64 deferrals on wsid-enterprise-architecture are the
 * demand signal this promotion exists to serve. Extend per family as the
 * next defer clusters fire.
 *
 * The mapping is TIER-AWARE by design: the gate's confidence is the MEAN of
 * applicable effective weights (evaluator.ts scoreProfileCoverage), so a
 * derived B/0.6 row scores 0.45 effective and arithmetically dilutes any
 * confirmed A/0.9 row sharing its domain class below the 0.7 recommend band.
 * Derived platform distillations therefore stay context-grade
 * (professional-practice only); human-vouched tiers (confirmed/ruled) carry
 * the family's decision classes and are what actually clear a tradeoff
 * consult. Confirming a platform page (BI-BE9C95D9's review surface)
 * upgrades its tier and thereby promotes it into the tradeoff class.
 */
const PROFESSION_DOMAIN_CLASS_MAP: Record<string, readonly ProfessionDomainClass[]> = {
  "enterprise-architecture": ["architecture-tradeoff", "professional-practice"],
};

export function professionDomainClasses(
  professionKey: string,
  tier: ProfessionMaterialTier,
): readonly ProfessionDomainClass[] {
  if (tier === "derived") return ["professional-practice"];
  return PROFESSION_DOMAIN_CLASS_MAP[professionKey] ?? ["professional-practice"];
}

/** materialId scheme, mirroring stanceMaterialId: primary keeps the short id. */
export function professionMaterialId(
  profileId: string,
  slug: string,
  domainClass: string,
  isPrimary: boolean,
): string {
  return isPrimary ? `${profileId}:${slug}` : `${profileId}:${slug}:${domainClass}`;
}

export type ProfessionPageSlugInfo = {
  professionKey: string;
  /** platform = seeded professions/<key>/ baseline; org-override = craft/<key>/ overlay. */
  corpus: "platform" | "org-override";
};

/**
 * Recognize the two profession corpus slug namespaces:
 *   professions/<professionKey>/<page>  — platform-seeded baseline
 *   craft/<professionKey>/<page>        — org craft override (CraftOverrideForm)
 * Returns null for every other slug shape.
 */
export function parseProfessionPageSlug(slug: string): ProfessionPageSlugInfo | null {
  const match = /^(professions|craft)\/([a-z0-9-]+)\/.+/.exec(slug);
  if (!match) return null;
  return {
    professionKey: match[2],
    corpus: match[1] === "professions" ? "platform" : "org-override",
  };
}

// ─── DB client surfaces (structural, satisfied by PrismaClient and fakes) ────

export type ProfessionMaterialPromotionClient = {
  decisionPerspectiveProfile: {
    findUnique(args: unknown): Promise<unknown>;
  };
  perspectiveMaterial: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
};

export type ProfessionCraftBackfillClient = ProfessionMaterialPromotionClient & {
  wikiPage: {
    findMany(args: unknown): Promise<unknown>;
  };
};

// ─── Promotion ───────────────────────────────────────────────────────────────

export type PromoteProfessionPageMaterialInput = {
  db: ProfessionMaterialPromotionClient;
  professionKey: string;
  /** The family's registry contextSlugs — drives the high-stakes hold. */
  contextSlugs: readonly string[];
  page: {
    id: string;
    slug: string;
    title: string;
    pageKind: string;
    abstract?: string | null;
  };
  tier: ProfessionMaterialTier;
};

export type PromoteProfessionPageMaterialResult =
  | {
      ok: true;
      profileId: string;
      /** materialIds written (or already at an equal/higher tier). */
      materialIds: string[];
      /** materialIds left untouched because they already sat at a higher tier. */
      keptHigherTier: string[];
      /** True when the written rows are approved+promoted (visible to the gate). */
      gateLive: boolean;
      /** True when the high-stakes hold kept the rows out of the gate. */
      heldForReview: boolean;
    }
  | { ok: false; error: "no-profession-profile" | "not-decision-bearing" };

/**
 * Upsert the page's material rows on the profession's wsid-<professionKey>
 * profile across its domain-class bundle. Idempotent; never downgrades tier
 * or review status.
 */
export async function promoteProfessionPageMaterial(
  input: PromoteProfessionPageMaterialInput,
): Promise<PromoteProfessionPageMaterialResult> {
  if (!isDecisionBearingPageKind(input.page.pageKind)) {
    return { ok: false, error: "not-decision-bearing" };
  }

  const profileId = `wsid-${input.professionKey}`;
  const profile = (await input.db.decisionPerspectiveProfile.findUnique({
    where: { profileId },
    select: { profileId: true, currentVersionId: true },
  })) as { profileId: string; currentVersionId: string | null } | null;

  if (!profile) {
    return { ok: false, error: "no-profession-profile" };
  }

  const tier = PROFESSION_MATERIAL_TIERS[input.tier];
  // The high-stakes hold applies only to unattended platform seeds; confirmed
  // and ruled tiers exist because a human acted, which IS the approval.
  const held = input.tier === "derived" && isHighStakesProfession(input.contextSlugs);

  const domainClasses = professionDomainClasses(input.professionKey, input.tier);
  const summary = input.page.abstract?.trim() || input.page.title;
  const materialIds: string[] = [];
  const keptHigherTier: string[] = [];

  for (const [index, domainClass] of domainClasses.entries()) {
    const materialId = professionMaterialId(profileId, input.page.slug, domainClass, index === 0);
    materialIds.push(materialId);

    const existing = (await input.db.perspectiveMaterial.findUnique({
      where: { materialId },
      select: { evidenceGrade: true, confidenceWeight: true, reviewStatus: true, promotionState: true },
    })) as {
      evidenceGrade: string;
      confidenceWeight: number;
      reviewStatus: string;
      promotionState: string;
    } | null;

    if (existing && TIER_RANK[tierOf(existing)] > TIER_RANK[input.tier]) {
      keptHigherTier.push(materialId);
      continue;
    }

    // Never pull an already-approved row back behind the review hold.
    const reviewStatus = held && existing?.reviewStatus !== "approved" ? "draft" : "approved";
    const promotionState =
      held && existing?.promotionState !== "promoted" ? "candidate" : "promoted";

    const sourceRef = {
      wikiPageId: input.page.id,
      slug: input.page.slug,
      professionKey: input.professionKey,
      corpus: input.tier === "derived" ? "platform" : "org-override",
    };

    await input.db.perspectiveMaterial.upsert({
      where: { materialId },
      update: {
        sourceType: input.page.pageKind,
        sourceRef,
        scope: { domains: [domainClass] },
        domainClass,
        domains: [domainClass],
        summary,
        freshness: "current",
        evidenceGrade: tier.evidenceGrade,
        confidenceWeight: tier.confidenceWeight,
        reviewStatus,
        promotionState,
        lastValidatedAt: new Date(),
      },
      create: {
        materialId,
        profileId: profile.profileId,
        profileVersionId: profile.currentVersionId ?? `${profile.profileId}-v1`,
        sourceType: input.page.pageKind,
        sourceRef,
        scope: { domains: [domainClass] },
        domainClass,
        direction: "support",
        domains: [domainClass],
        freshness: "current",
        evidenceGrade: tier.evidenceGrade,
        confidenceWeight: tier.confidenceWeight,
        reviewStatus,
        promotionState,
        summary,
        lastValidatedAt: new Date(),
      },
    });
  }

  return {
    ok: true,
    profileId: profile.profileId,
    materialIds,
    keptHigherTier,
    gateLive: !held,
    heldForReview: held,
  };
}

// ─── Backfill ────────────────────────────────────────────────────────────────

export type ProfessionFamilyContext = {
  professionKey: string;
  contextSlugs: string[];
};

function loadProfessionFamilyContexts(): ProfessionFamilyContext[] {
  const registryPath = join(__dirname, "../../../docs/professions/registry.json");
  const raw = readFileSync(registryPath, "utf-8");
  const data = JSON.parse(raw) as {
    families: Array<{ professionKey: string; contextSlugs?: string[] }>;
  };
  return data.families.map((family) => ({
    professionKey: family.professionKey,
    contextSlugs: family.contextSlugs ?? [],
  }));
}

export type BackfillProfessionCraftMaterialsResult = {
  /** Published corpus/override pages examined. */
  scanned: number;
  /** Pages whose material rows were written this run. */
  promoted: number;
  /** Pages whose rows are approved+promoted (gate-visible). */
  gateLive: number;
  /** Pages held as draft/candidate by the high-stakes hold. */
  heldForReview: number;
  /** Pages skipped because their rows already sat at a higher tier. */
  keptHigherTier: number;
  /** Context-only pages (entity/summary/runbook) — not decision-bearing. */
  notDecisionBearing: number;
  /** Real anomalies worth a loud log line. */
  skipped: Array<{ slug: string; reason: string }>;
};

/**
 * One-shot idempotent backfill for the existing published corpus: every
 * professions/<key>/ platform page enters at the derived tier, every
 * craft/<key>/ org override that a human already published enters at the
 * confirmed tier. Runs from the seed (fresh installs get materials with their
 * corpus; existing installs converge on the next seed run).
 */
export async function backfillProfessionCraftMaterials(
  db: ProfessionCraftBackfillClient,
  options?: { loadFamilies?: () => ProfessionFamilyContext[] },
): Promise<BackfillProfessionCraftMaterialsResult> {
  const families = (options?.loadFamilies ?? loadProfessionFamilyContexts)();
  const familyByKey = new Map(families.map((family) => [family.professionKey, family]));

  const pages = (await db.wikiPage.findMany({
    where: {
      status: "published",
      OR: [
        { slug: { startsWith: "professions/" }, organizationId: null },
        { slug: { startsWith: "craft/" } },
      ],
    },
    select: {
      id: true,
      slug: true,
      title: true,
      pageKind: true,
      abstract: true,
      organizationId: true,
    },
    orderBy: { slug: "asc" },
  })) as Array<{
    id: string;
    slug: string;
    title: string;
    pageKind: string;
    abstract: string | null;
    organizationId: string | null;
  }>;

  const result: BackfillProfessionCraftMaterialsResult = {
    scanned: pages.length,
    promoted: 0,
    gateLive: 0,
    heldForReview: 0,
    keptHigherTier: 0,
    notDecisionBearing: 0,
    skipped: [],
  };

  for (const page of pages) {
    const slugInfo = parseProfessionPageSlug(page.slug);
    if (!slugInfo) {
      result.skipped.push({ slug: page.slug, reason: "unparseable profession slug" });
      continue;
    }

    const family = familyByKey.get(slugInfo.professionKey);
    if (!family) {
      result.skipped.push({
        slug: page.slug,
        reason: `professionKey "${slugInfo.professionKey}" is not in docs/professions/registry.json`,
      });
      continue;
    }

    if (!isDecisionBearingPageKind(page.pageKind)) {
      result.notDecisionBearing++;
      continue;
    }

    const promoted = await promoteProfessionPageMaterial({
      db,
      professionKey: slugInfo.professionKey,
      contextSlugs: family.contextSlugs,
      page,
      tier: slugInfo.corpus === "platform" ? "derived" : "confirmed",
    });

    if (!promoted.ok) {
      result.skipped.push({ slug: page.slug, reason: promoted.error });
      continue;
    }

    if (promoted.keptHigherTier.length === promoted.materialIds.length) {
      result.keptHigherTier++;
      continue;
    }

    result.promoted++;
    if (promoted.heldForReview) result.heldForReview++;
    else result.gateLive++;
  }

  return result;
}
