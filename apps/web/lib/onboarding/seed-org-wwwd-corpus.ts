// Onboarding WWWD ("What Would We Do") seeding.
//
// Runs once when initial portal setup completes. It turns the captured
// company mission + the chosen archetype into a real, per-org decision
// corpus so coworkers stop falling straight back to Mark's platform
// doctrine when asked "what would we do?".
//
// Two substrates are seeded (verified against live code, 2026-05-31):
//   1. The WORKING WWWD lever — org-overlay WikiPages (organizationId set,
//      isKernel=false, pageKind stance/principle, status "published"),
//      embedded into Qdrant via storeWikiPage. agent-coworker.ts retrieves
//      these by org for WWWD answers (recallWikiContext).
//   2. The corpus CONTAINER — a per-org DecisionPerspectiveProfile
//      (kind=organization, ownerOrganizationId, fallback
//      dpf-organizational-principles) + a v1 version + PerspectiveMaterial
//      rows linking back to the wiki pages. No decision path consumes the
//      profile by ownerOrganizationId yet (see BI-230C9EF7); it is seeded
//      so the corpus exists the moment resolution lands.
//
// Idempotent: profile / version / material writes are upserts keyed on
// stable ids, wiki pages are upserted by (organizationId, slug), and a new
// revision + re-embed only happen when the page body actually changes.
// Safe to re-run on re-completion or replay.
//
// 2026-07-11 (BI-70ADC71F, stance-onboarding design): seeding now covers ALL
// FOUR decision classes, not just plan-readiness — 4 identity pages plus 5
// archetype-default stance-vector pages (goodwill, pricing, growth-vs-
// stability, quality bar, spend authority), each landing PerspectiveMaterial
// in its class bundle at unconfirmed B/0.6. Unconfirmed defaults still clear
// nothing (effective 0.45 < every band) — the "How you decide" step upgrades
// confirmed bundles to A/0.9. Re-seeding an existing install retags the
// org-supply-chain material into architecture-tradeoff and never downgrades
// an owner-confirmed or human-ruled material.

import { prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";
import { storeWikiPage, type StoreWikiPageInput } from "@/lib/wiki/embeddings";
import { DECISION_DOMAIN_CLASSES, type DecisionDomainClass } from "@/lib/decision-perspective/types";
import {
  projectDeclaredStanceAlignment,
  projectStanceDimensionVector,
  type StanceDimensionProjection,
} from "@/lib/decision-perspective/stance-dimension-map";
import { suggestMission } from "./mission-suggestion";
import { deriveExcellenceCorpus, excellenceCorpusToMarkdown } from "./excellence-corpus";
import {
  resolveBusinessProfile,
  resolveStanceVectors,
  STANCE_VECTOR_KEYS,
  type StanceVectorKey,
} from "./archetype-business-context";

/** Platform fallback our org profile chains to (material.ts:14). */
export const ORG_PERSPECTIVE_FALLBACK_PROFILE_ID = "dpf-organizational-principles";
const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";

/**
 * Which decision classes each stance vector's material lands in (the "gate
 * bundle" from the 2026-07-11 stance-onboarding design §3). The FIRST class is
 * the primary (keeps the legacy `{profileId}:{slug}` materialId so re-seeding
 * an existing install retags rather than duplicates); the rest are echoes.
 */
export const STANCE_VECTOR_BUNDLES: Record<StanceVectorKey, DecisionDomainClass[]> = {
  "customer-goodwill": ["risk-assessment", "professional-practice"],
  "pricing-integrity": ["risk-assessment"],
  "growth-vs-stability": ["plan-readiness"],
  "quality-bar": ["professional-practice"],
  "spend-authority": ["risk-assessment", "architecture-tradeoff"],
};

/** Org-overlay slug for a stance vector page (shown under /coworker-decisions/stance). */
export function stanceVectorSlug(key: StanceVectorKey): string {
  return `stances/${key}`;
}

const DEFAULT_AUTONOMY_POLICY = {
  allowRecommendation: true,
  allowArbitration: false,
  maxRiskForArbitration: "low",
  minimumConfidenceForRecommendation: 0.55,
  minimumConfidenceForArbitration: 0.9,
};

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type SeedOrgWwwdClient = {
  businessContext: { findUnique: (args: unknown) => Promise<unknown> };
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
  organization: { findUnique: (args: unknown) => Promise<unknown> };
  decisionPerspectiveProfile: {
    upsert: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  decisionPerspectiveProfileVersion: { upsert: (args: unknown) => Promise<unknown> };
  perspectiveMaterial: { upsert: (args: unknown) => Promise<unknown> };
  wikiPage: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  wikiPageRevision: {
    findFirst: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type SeedOrgWwwdCorpusInput = {
  organizationId: string;
  /** Defaults to the shared prisma client. */
  db?: SeedOrgWwwdClient;
  /** Qdrant index step; injectable for tests. Defaults to storeWikiPage. */
  embed?: (input: StoreWikiPageInput) => Promise<boolean>;
};

export type SeedOrgWwwdCorpusResult = {
  profileId: string;
  versionId: string;
  wikiPageIds: string[];
  materialCount: number;
  /** True only if every published page was successfully embedded. */
  embedded: boolean;
};

type SeedPage = {
  slug: string;
  title: string;
  pageKind: "principle" | "stance";
  body: string;
  abstract: string;
  /**
   * The decision classes this page's material lands in. The first entry is the
   * primary class (legacy `{profileId}:{slug}` materialId); additional entries
   * become echo materials keyed `{profileId}:{slug}:{class}`.
   */
  bundles: DecisionDomainClass[];
  /** Explicit stance-purpose projection into the shared decision axes. */
  dimensionProjection?: StanceDimensionProjection;
  /** Set on the mission principle page so it is well-formed. */
  principle?: {
    principleTier: "core";
    principleAppliesTo: string[];
    principleDirection: string;
  };
};

type BusinessContextRow = {
  mission: string | null;
  description: string | null;
  targetMarket: string | null;
  industry: string | null;
} | null;

function buildPages(
  bc: BusinessContextRow,
  archetypeId: string | null,
  industry: string | null,
  orgName: string | null,
): SeedPage[] {
  const profile = resolveBusinessProfile({ archetypeId, industry: industry ?? bc?.industry ?? null });
  // Excellence Corpus (workstream B): "what great looks like" for this archetype,
  // seeded as unconfirmed priming so the AI cog starts from a picture of a well-run
  // one rather than a blank slate.
  const excellence = deriveExcellenceCorpus({
    archetypeId,
    industry: industry ?? bc?.industry ?? null,
    ctaType: null,
  });

  const mission =
    (bc?.mission ?? "").trim() ||
    suggestMission({
      archetypeId,
      industry: industry ?? bc?.industry ?? null,
      description: bc?.description ?? null,
      orgName,
    });
  const who = (bc?.targetMarket ?? "").trim();
  const what = (bc?.description ?? "").trim();
  const orgLabel = (orgName ?? "").trim() || "this organization";

  // Who-we-serve: lead with the captured target market when present, then the
  // archetype-aware framing so the page reads like it understands the business.
  const whoLead = who
    ? `We serve ${who}.`
    : profile.whoWeServe;
  const whoAbstract = who ? `We serve ${who}.` : profile.whoWeServe;

  const pages: SeedPage[] = [
    {
      slug: "org-mission",
      title: "Our mission",
      pageKind: "principle",
      bundles: ["plan-readiness"],
      body: [
        "# Our mission",
        "",
        mission,
        "",
        "Every action, recommendation, and decision should advance this mission. When a request conflicts with it, surface the conflict rather than proceeding silently.",
      ].join("\n"),
      abstract: mission,
      principle: {
        principleTier: "core",
        principleAppliesTo: ["in_platform_coworker", "human"],
        principleDirection: mission,
      },
    },
    {
      slug: "org-who-we-serve",
      title: "Who we serve",
      pageKind: "stance",
      bundles: ["plan-readiness"],
      body: [
        "# Who we serve",
        "",
        whoLead,
        what ? `\nWhat we do: ${what}` : "",
        `\nHow this business works: ${profile.businessModel}`,
        "\nWhen we decide \"what would we do?\", we weigh the interests of the people we serve first.",
      ].join("\n"),
      abstract: whoAbstract,
      dimensionProjection: projectDeclaredStanceAlignment(["market_fit", "product_fit"]),
    },
    {
      slug: "org-how-we-decide",
      title: "How we decide",
      pageKind: "stance",
      // Echoes into professional-practice: the how-we-decide framing carries
      // the craft/quality posture for that class alongside quality-bar.
      bundles: ["plan-readiness", "professional-practice"],
      body: [
        "# How we decide",
        "",
        profile.howWeDecide,
        "",
        `This is ${orgLabel}'s starting decision stance, derived from how this kind of business tends to operate. Refine it as the organization's own judgment is captured.`,
      ].join("\n"),
      abstract: profile.howWeDecide,
      dimensionProjection: projectDeclaredStanceAlignment(["mission_fit", "gtm_fit"]),
    },
    {
      slug: "org-supply-chain",
      title: "How we work with suppliers",
      pageKind: "stance",
      // Retagged (2026-07-11 design §3): supplier posture governs structural
      // vendor/tooling choices, not plan-readiness. Re-seeding an existing
      // install moves the material via the upsert update clause.
      bundles: ["architecture-tradeoff"],
      body: [
        "# How we work with suppliers",
        "",
        profile.supplyChain,
        "",
        `This is ${orgLabel}'s starting supplier and supply-chain stance, derived from how this kind of business typically runs. Refine it as actual suppliers, vendors, and purchasing rhythms are captured.`,
      ].join("\n"),
      abstract: profile.supplyChain,
      dimensionProjection: projectDeclaredStanceAlignment(["product_fit", "gtm_fit"]),
    },
    {
      // Excellence Corpus (workstream B): the "what great looks like" primer, so
      // the AI cog starts from a picture of a well-run one, not a blank slate.
      slug: "org-what-great-looks-like",
      title: "What great looks like",
      pageKind: "principle",
      bundles: ["plan-readiness"],
      body: excellenceCorpusToMarkdown(excellence, orgLabel),
      abstract: excellence.whatGreatLooksLike,
    },
  ];

  // The 5 coverage vectors (stance-onboarding design §3-4): archetype-default
  // stance pages whose materials prime every decision class. Unconfirmed
  // starters — the owner confirms/adjusts them in the "How you decide" step.
  const vectors = resolveStanceVectors({ archetypeId, industry: industry ?? bc?.industry ?? null });
  for (const key of STANCE_VECTOR_KEYS) {
    const v = vectors[key];
    const ceiling =
      v.ceilingUsd != null && v.ceilingUsd > 0
        ? `\nAuthority ceiling: up to $${v.ceilingUsd} per case may be resolved without the owner; above that, the owner decides.`
        : "";
    pages.push({
      slug: stanceVectorSlug(key),
      title: v.title,
      pageKind: "stance",
      bundles: STANCE_VECTOR_BUNDLES[key],
      body: [
        `# ${v.title}`,
        "",
        v.stance,
        ceiling,
        "",
        `This is ${orgLabel}'s starting stance, derived from how this kind of business tends to operate. Confirm or adjust it — a confirmed stance lets your AI coworkers act on it.`,
      ].join("\n"),
      abstract: v.stance,
      dimensionProjection: projectStanceDimensionVector(key),
    });
  }

  return pages;
}

export async function seedOrgWwwdCorpus(
  input: SeedOrgWwwdCorpusInput,
): Promise<SeedOrgWwwdCorpusResult> {
  const db = (input.db ?? (prisma as unknown as SeedOrgWwwdClient));
  const embed = input.embed ?? storeWikiPage;
  const organizationId = input.organizationId;

  const profileId = `org-perspective-${organizationId}`;
  const versionId = `${profileId}-v1`;

  const [bc, sf, org] = await Promise.all([
    db.businessContext.findUnique({
      where: { organizationId },
      select: { mission: true, description: true, targetMarket: true, industry: true },
    }) as Promise<BusinessContextRow>,
    db.storefrontConfig.findFirst({
      select: { archetypeId: true, archetype: { select: { name: true, category: true } } },
    }) as Promise<{
      archetypeId: string | null;
      archetype: { name: string; category: string } | null;
    } | null>,
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }) as Promise<{ name: string | null } | null>,
  ]);

  const archetypeId = sf?.archetypeId ?? null;
  const industry = sf?.archetype?.category ?? bc?.industry ?? null;
  const orgName = org?.name ?? null;

  // 0. Ensure the platform fallback profile ROW exists. The org profile's
  // fallbackProfileId carries an FK to it, but the fallback shipped only as an
  // in-code constant (default-profile.ts) — no seed ever materialized it, so
  // this upsert threw P2003 on every install and the fail-open completion
  // chain swallowed it: THE reason the WWWD substrate stayed dormant
  // (observed live 2026-07-06, BI-44526F3E). Minimal row, no version — the
  // resolution chain only needs the profile to exist.
  await db.decisionPerspectiveProfile.upsert({
    where: { profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID },
    update: {},
    create: {
      profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      name: "DPF Organizational Principles",
      kind: "organization",
      scope: { domains: ["platform-governance", PLAN_READINESS_DOMAIN_CLASS] },
      fallbackProfileId: null,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
  });

  // 1. Profile (container).
  await db.decisionPerspectiveProfile.upsert({
    where: { profileId },
    update: {
      name: `${orgName ?? "Organization"} perspective`,
      kind: "organization",
      scope: { domains: [...DECISION_DOMAIN_CLASSES] },
      ownerOrganizationId: organizationId,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
    create: {
      profileId,
      name: `${orgName ?? "Organization"} perspective`,
      kind: "organization",
      scope: { domains: [...DECISION_DOMAIN_CLASSES] },
      ownerOrganizationId: organizationId,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: DEFAULT_AUTONOMY_POLICY,
      status: "active",
    },
  });

  // 2. Version v1.
  await db.decisionPerspectiveProfileVersion.upsert({
    where: { versionId },
    update: { changeSummary: "Organization perspective seeded at onboarding." },
    create: {
      versionId,
      profileId,
      versionNumber: 1,
      materialFingerprint: `seed:${profileId}:v1`,
      changeSummary: "Organization perspective seeded at onboarding.",
    },
  });

  // 3. Org-overlay wiki pages (the working WWWD lever) + materials.
  const pages = buildPages(bc, archetypeId, industry, orgName);
  const wikiPageIds: string[] = [];
  let embedded = true;
  let materialCount = 0;

  for (const page of pages) {
    const existing = (await db.wikiPage.findFirst({
      where: { organizationId, slug: page.slug },
      select: { id: true, body: true },
    })) as { id: string; body: string } | null;

    const saved = (await upsertWikiPage(db as unknown as Parameters<typeof upsertWikiPage>[0], {
      organizationId,
      slug: page.slug,
      title: page.title,
      body: page.body,
      pageKind: page.pageKind,
      status: "published",
      isKernel: false,
      abstract: page.abstract,
      ...(page.principle
        ? {
            principleTier: page.principle.principleTier,
            principleAppliesTo: page.principle.principleAppliesTo,
            principleDirection: page.principle.principleDirection,
          }
        : {}),
      ...(page.dimensionProjection ?? {}),
    })) as { id: string };

    wikiPageIds.push(saved.id);

    // Only append a revision + re-embed when the content actually changed —
    // keeps re-runs a true no-op on the revision log and the embedding API.
    const changed = !existing || existing.body !== page.body;
    if (changed) {
      await appendRevision(db as unknown as Parameters<typeof appendRevision>[0], {
        pageId: saved.id,
        title: page.title,
        body: page.body,
        changeKind: "ingest",
        changeSummary: "onboarding seed",
      });

      const ok = await embed({
        pageId: saved.id,
        slug: page.slug,
        title: page.title,
        body: page.body,
        abstract: page.abstract,
        pageKind: page.pageKind,
        status: "published",
        isKernel: false,
        kernelVersion: null,
        organizationId,
        kernelPageId: null,
        ...(page.principle
          ? {
              principleTier: page.principle.principleTier,
              principleAppliesTo: page.principle.principleAppliesTo,
            }
          : {}),
        ...(page.dimensionProjection ?? {}),
      });
      if (!ok) embedded = false;
    }

    // Materials linking the version to the wiki page — one per bundle class.
    // The primary class keeps the legacy `{profileId}:{slug}` id so re-seeding
    // an existing install RETAGS its row (update sets domainClass) instead of
    // duplicating; echo classes get `{profileId}:{slug}:{class}` ids.
    // NOTE: the update clause deliberately does NOT touch evidenceGrade /
    // confidenceWeight / reviewStatus / promotionState — an owner-confirmed
    // (A/0.9) or human-ruled (A/1.0) upgrade must survive a re-seed.
    for (const [bundleIndex, domainClass] of page.bundles.entries()) {
      const materialId =
        bundleIndex === 0 ? `${profileId}:${page.slug}` : `${profileId}:${page.slug}:${domainClass}`;
      materialCount += 1;
      await db.perspectiveMaterial.upsert({
        where: { materialId },
        update: {
          profileVersionId: versionId,
          sourceType: page.pageKind,
          sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
          scope: { domains: [domainClass] },
          domainClass,
          domains: [domainClass],
          summary: page.abstract,
          freshness: "current",
        },
        create: {
          materialId,
          profileId,
          profileVersionId: versionId,
          sourceType: page.pageKind,
          sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
          scope: { domains: [domainClass] },
          domainClass,
          direction: "support",
          domains: [domainClass],
          freshness: "current",
          evidenceGrade: "B",
          confidenceWeight: 0.6,
          reviewStatus: "approved",
          promotionState: "promoted",
          summary: page.abstract,
        },
      });
    }
  }

  // 4. Point the profile at v1.
  await db.decisionPerspectiveProfile.update({
    where: { profileId },
    data: { currentVersionId: versionId },
  });

  return {
    profileId,
    versionId,
    wikiPageIds,
    materialCount,
    embedded,
  };
}
