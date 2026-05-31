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

import { prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";
import { storeWikiPage, type StoreWikiPageInput } from "@/lib/wiki/embeddings";
import { suggestMission } from "./mission-suggestion";
import { resolveBusinessProfile } from "./archetype-business-context";

/** Platform fallback our org profile chains to (material.ts:14). */
export const ORG_PERSPECTIVE_FALLBACK_PROFILE_ID = "dpf-organizational-principles";
const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";

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
      body: [
        "# Who we serve",
        "",
        whoLead,
        what ? `\nWhat we do: ${what}` : "",
        `\nHow this business works: ${profile.businessModel}`,
        "\nWhen we decide \"what would we do?\", we weigh the interests of the people we serve first.",
      ].join("\n"),
      abstract: whoAbstract,
    },
    {
      slug: "org-how-we-decide",
      title: "How we decide",
      pageKind: "stance",
      body: [
        "# How we decide",
        "",
        profile.howWeDecide,
        "",
        `This is ${orgLabel}'s starting decision stance, derived from how this kind of business tends to operate. Refine it as the organization's own judgment is captured.`,
      ].join("\n"),
      abstract: profile.howWeDecide,
    },
    {
      slug: "org-supply-chain",
      title: "How we work with suppliers",
      pageKind: "stance",
      body: [
        "# How we work with suppliers",
        "",
        profile.supplyChain,
        "",
        `This is ${orgLabel}'s starting supplier and supply-chain stance, derived from how this kind of business typically runs. Refine it as actual suppliers, vendors, and purchasing rhythms are captured.`,
      ].join("\n"),
      abstract: profile.supplyChain,
    },
  ];
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

  // 1. Profile (container).
  await db.decisionPerspectiveProfile.upsert({
    where: { profileId },
    update: {
      name: `${orgName ?? "Organization"} perspective`,
      kind: "organization",
      scope: { domains: [PLAN_READINESS_DOMAIN_CLASS] },
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
      scope: { domains: [PLAN_READINESS_DOMAIN_CLASS] },
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
      });
      if (!ok) embedded = false;
    }

    // Material linking the version to the wiki page.
    const materialId = `${profileId}:${page.slug}`;
    await db.perspectiveMaterial.upsert({
      where: { materialId },
      update: {
        profileVersionId: versionId,
        sourceType: page.pageKind,
        sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
        summary: page.abstract,
        freshness: "current",
      },
      create: {
        materialId,
        profileId,
        profileVersionId: versionId,
        sourceType: page.pageKind,
        sourceRef: { wikiPageId: saved.id, slug: page.slug, organizationId },
        scope: { domains: [PLAN_READINESS_DOMAIN_CLASS] },
        domainClass: PLAN_READINESS_DOMAIN_CLASS,
        direction: "support",
        domains: [PLAN_READINESS_DOMAIN_CLASS],
        freshness: "current",
        evidenceGrade: "B",
        confidenceWeight: 0.6,
        reviewStatus: "approved",
        promotionState: "promoted",
        summary: page.abstract,
      },
    });
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
    materialCount: pages.length,
    embedded,
  };
}
