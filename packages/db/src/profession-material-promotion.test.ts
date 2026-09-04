import { describe, expect, it, vi } from "vitest";

import {
  backfillProfessionCraftMaterials,
  DECISION_BEARING_PAGE_KINDS,
  isHighStakesProfession,
  parseProfessionPageSlug,
  PROFESSION_MATERIAL_TIERS,
  professionDomainClasses,
  professionMaterialId,
  promoteProfessionPageMaterial,
  type ProfessionCraftBackfillClient,
} from "./profession-material-promotion";

type Row = Record<string, any>;

function makeFakeDb(opts: { profiles?: Row[]; materials?: Row[]; pages?: Row[] }) {
  const materials: Row[] = opts.materials ?? [];
  const profiles: Row[] = opts.profiles ?? [];
  const db: ProfessionCraftBackfillClient = {
    decisionPerspectiveProfile: {
      findUnique: vi.fn(async (args: any) => {
        return profiles.find((p) => p.profileId === args.where.profileId) ?? null;
      }),
    },
    perspectiveMaterial: {
      findUnique: vi.fn(async (args: any) => {
        return materials.find((m) => m.materialId === args.where.materialId) ?? null;
      }),
      upsert: vi.fn(async (args: any) => {
        const found = materials.find((m) => m.materialId === args.where.materialId);
        if (found) {
          Object.assign(found, args.update);
          return found;
        }
        const row = { ...args.create };
        materials.push(row);
        return row;
      }),
    },
    wikiPage: {
      findMany: vi.fn(async () => opts.pages ?? []),
    },
  };
  return { db, materials };
}

const EA_PROFILE = {
  profileId: "wsid-enterprise-architecture",
  currentVersionId: "wsid-enterprise-architecture-v1",
};
const FINANCE_PROFILE = { profileId: "wsid-finance", currentVersionId: "wsid-finance-v1" };

const EA_PAGE = {
  id: "wp_adr",
  slug: "professions/enterprise-architecture/record-decisions-as-adrs",
  title: "Record decisions as ADRs",
  pageKind: "principle",
  abstract: "Every consequential architecture decision gets an ADR.",
};

describe("registry helpers", () => {
  it("parses both profession slug namespaces and rejects others", () => {
    expect(parseProfessionPageSlug(EA_PAGE.slug)).toEqual({
      professionKey: "enterprise-architecture",
      corpus: "platform",
    });
    expect(parseProfessionPageSlug("craft/enterprise-architecture/verify-the-substrate-first")).toEqual({
      professionKey: "enterprise-architecture",
      corpus: "org-override",
    });
    expect(parseProfessionPageSlug("stances/customer-goodwill")).toBeNull();
    expect(parseProfessionPageSlug("professions/")).toBeNull();
    expect(parseProfessionPageSlug("craft/x")).toBeNull();
  });

  it("maps human-vouched EA tiers to architecture-tradeoff primary; derived stays context-grade", () => {
    expect(professionDomainClasses("enterprise-architecture", "confirmed")).toEqual([
      "architecture-tradeoff",
      "professional-practice",
    ]);
    expect(professionDomainClasses("enterprise-architecture", "ruled")).toEqual([
      "architecture-tradeoff",
      "professional-practice",
    ]);
    // Derived B/0.6 rows score 0.45 effective — letting them share the
    // tradeoff class would dilute confirmed rows below the recommend band.
    expect(professionDomainClasses("enterprise-architecture", "derived")).toEqual([
      "professional-practice",
    ]);
    expect(professionDomainClasses("marketing", "confirmed")).toEqual(["professional-practice"]);
  });

  it("flags finance/compliance context slugs as high-stakes", () => {
    expect(isHighStakesProfession(["finance"])).toBe(true);
    expect(isHighStakesProfession(["data-security", "compliance"])).toBe(true);
    expect(isHighStakesProfession(["engineering-flow"])).toBe(false);
    // The trigger is finance/compliance specifically, NOT "sounds sensitive".
    // data-architect carries data-security and is deliberately NOT held, so an
    // adjacent-sounding slug must not start withholding its material
    // (BI-5F3BFD13).
    expect(isHighStakesProfession(["data-model", "data-security"])).toBe(false);
  });

  it("tier ladder matches the stance ladder shape (derived is the B rung)", () => {
    expect(PROFESSION_MATERIAL_TIERS.derived).toEqual({ evidenceGrade: "B", confidenceWeight: 0.6 });
    expect(PROFESSION_MATERIAL_TIERS.confirmed).toEqual({ evidenceGrade: "A", confidenceWeight: 0.9 });
    expect(PROFESSION_MATERIAL_TIERS.ruled).toEqual({ evidenceGrade: "A", confidenceWeight: 1.0 });
  });

  it("materialId scheme mirrors stanceMaterialId (primary keeps the short id)", () => {
    expect(professionMaterialId("wsid-x", "professions/x/p", "architecture-tradeoff", true)).toBe(
      "wsid-x:professions/x/p",
    );
    expect(professionMaterialId("wsid-x", "professions/x/p", "professional-practice", false)).toBe(
      "wsid-x:professions/x/p:professional-practice",
    );
  });
});

describe("promoteProfessionPageMaterial", () => {
  it("returns no-profession-profile when the wsid profile is not seeded", async () => {
    const { db } = makeFakeDb({ profiles: [] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "enterprise-architecture",
      contextSlugs: ["engineering-flow"],
      page: EA_PAGE,
      tier: "derived",
    });
    expect(result).toEqual({ ok: false, error: "no-profession-profile" });
  });

  it("refuses context-only page kinds (entity/summary stay retrieval-only)", async () => {
    const { db, materials } = makeFakeDb({ profiles: [EA_PROFILE] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "enterprise-architecture",
      contextSlugs: ["engineering-flow"],
      page: { ...EA_PAGE, pageKind: "entity" },
      tier: "derived",
    });
    expect(result).toEqual({ ok: false, error: "not-decision-bearing" });
    expect(materials).toHaveLength(0);
  });

  it("writes a gate-live B/0.6 professional-practice row for a platform-seeded EA principle", async () => {
    const { db, materials } = makeFakeDb({ profiles: [EA_PROFILE] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "enterprise-architecture",
      contextSlugs: ["engineering-flow"],
      page: EA_PAGE,
      tier: "derived",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gateLive).toBe(true);
    expect(result.heldForReview).toBe(false);
    expect(materials).toHaveLength(1);
    expect(materials[0]).toMatchObject({
      materialId: `wsid-enterprise-architecture:${EA_PAGE.slug}`,
      profileId: "wsid-enterprise-architecture",
      domainClass: "professional-practice",
      sourceType: "principle",
      evidenceGrade: "B",
      confidenceWeight: 0.6,
      reviewStatus: "approved",
      promotionState: "promoted",
      direction: "support",
      summary: EA_PAGE.abstract,
    });
    expect(materials[0].sourceRef).toMatchObject({
      wikiPageId: EA_PAGE.id,
      professionKey: "enterprise-architecture",
      corpus: "platform",
    });
  });

  it("writes confirmed A/0.9 gate-live rows for a published org craft override, tradeoff-primary", async () => {
    const { db, materials } = makeFakeDb({ profiles: [EA_PROFILE] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "enterprise-architecture",
      contextSlugs: ["engineering-flow"],
      page: {
        id: "wp_craft",
        slug: "craft/enterprise-architecture/verify-the-substrate-first",
        title: "Verify the substrate first",
        pageKind: "heuristic",
        abstract: null,
      },
      tier: "confirmed",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gateLive).toBe(true);
    expect(materials).toHaveLength(2);
    expect(materials[0]).toMatchObject({
      materialId: "wsid-enterprise-architecture:craft/enterprise-architecture/verify-the-substrate-first",
      domainClass: "architecture-tradeoff",
      evidenceGrade: "A",
      confidenceWeight: 0.9,
      reviewStatus: "approved",
      promotionState: "promoted",
      // No abstract → the title carries the summary.
      summary: "Verify the substrate first",
    });
    expect(materials[1]).toMatchObject({ domainClass: "professional-practice" });
    expect(materials[0].sourceRef).toMatchObject({ corpus: "org-override" });
  });

  it("holds high-stakes derived material out of the gate (draft/candidate)", async () => {
    const { db, materials } = makeFakeDb({ profiles: [FINANCE_PROFILE] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "finance",
      contextSlugs: ["finance"],
      page: {
        id: "wp_gaap",
        slug: "professions/finance/revenue-recognized-when-earned",
        title: "Revenue is recognized when earned",
        pageKind: "principle",
      },
      tier: "derived",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gateLive).toBe(false);
    expect(result.heldForReview).toBe(true);
    expect(materials[0]).toMatchObject({
      evidenceGrade: "B",
      confidenceWeight: 0.6,
      reviewStatus: "draft",
      promotionState: "candidate",
    });
  });

  it("high-stakes CONFIRMED tier goes gate-live (a human published it)", async () => {
    const { db, materials } = makeFakeDb({ profiles: [FINANCE_PROFILE] });
    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "finance",
      contextSlugs: ["finance"],
      page: {
        id: "wp_fin_craft",
        slug: "craft/finance/close-on-the-fifth",
        title: "Close on the fifth",
        pageKind: "heuristic",
      },
      tier: "confirmed",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.gateLive).toBe(true);
    expect(materials[0]).toMatchObject({ reviewStatus: "approved", promotionState: "promoted" });
  });

  it("NEVER downgrades: a confirmed row survives a later derived re-seed", async () => {
    const existing = {
      materialId: `wsid-enterprise-architecture:${EA_PAGE.slug}`,
      evidenceGrade: "A",
      confidenceWeight: 0.9,
      reviewStatus: "approved",
      promotionState: "promoted",
    };
    const { db, materials } = makeFakeDb({ profiles: [EA_PROFILE], materials: [existing] });

    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "enterprise-architecture",
      contextSlugs: ["engineering-flow"],
      page: EA_PAGE,
      tier: "derived",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keptHigherTier).toContain(existing.materialId);
    expect(materials[0].confidenceWeight).toBe(0.9);
  });

  it("never pulls an already-approved row back behind the high-stakes hold", async () => {
    const approved = {
      materialId: "wsid-finance:professions/finance/revenue-recognized-when-earned",
      evidenceGrade: "B",
      confidenceWeight: 0.6,
      reviewStatus: "approved",
      promotionState: "promoted",
    };
    const { db, materials } = makeFakeDb({ profiles: [FINANCE_PROFILE], materials: [approved] });

    const result = await promoteProfessionPageMaterial({
      db,
      professionKey: "finance",
      contextSlugs: ["finance"],
      page: {
        id: "wp_gaap",
        slug: "professions/finance/revenue-recognized-when-earned",
        title: "Revenue is recognized when earned",
        pageKind: "principle",
      },
      tier: "derived",
    });

    expect(result.ok).toBe(true);
    expect(materials[0].reviewStatus).toBe("approved");
    expect(materials[0].promotionState).toBe("promoted");
  });
});

describe("backfillProfessionCraftMaterials", () => {
  const families = [
    { professionKey: "enterprise-architecture", contextSlugs: ["engineering-flow"] },
    { professionKey: "finance", contextSlugs: ["finance"] },
  ];

  it("promotes platform pages at derived, craft overrides at confirmed, and counts context pages", async () => {
    const { db, materials } = makeFakeDb({
      profiles: [EA_PROFILE, FINANCE_PROFILE],
      pages: [
        { ...EA_PAGE, organizationId: null, abstract: EA_PAGE.abstract },
        {
          id: "wp_entity",
          slug: "professions/enterprise-architecture/togaf-adm-phases",
          title: "TOGAF ADM phases",
          pageKind: "entity",
          abstract: null,
          organizationId: null,
        },
        {
          id: "wp_craft",
          slug: "craft/enterprise-architecture/architecture-review-verdicts",
          title: "Architecture review verdicts",
          pageKind: "heuristic",
          abstract: null,
          organizationId: "org_1",
        },
        {
          id: "wp_gaap",
          slug: "professions/finance/revenue-recognized-when-earned",
          title: "Revenue recognized when earned",
          pageKind: "principle",
          abstract: null,
          organizationId: null,
        },
        {
          id: "wp_unknown",
          slug: "professions/underwater-basket-weaving/knots",
          title: "Knots",
          pageKind: "principle",
          abstract: null,
          organizationId: null,
        },
      ],
    });

    const result = await backfillProfessionCraftMaterials(db, { loadFamilies: () => families });

    expect(result.scanned).toBe(5);
    expect(result.promoted).toBe(3);
    expect(result.gateLive).toBe(2); // EA platform + EA craft
    expect(result.heldForReview).toBe(1); // finance platform page held
    expect(result.notDecisionBearing).toBe(1);
    expect(result.skipped).toEqual([
      {
        slug: "professions/underwater-basket-weaving/knots",
        reason: expect.stringContaining("underwater-basket-weaving"),
      },
    ]);

    const craftRow = materials.find(
      (m) => m.materialId === "wsid-enterprise-architecture:craft/enterprise-architecture/architecture-review-verdicts",
    );
    expect(craftRow).toMatchObject({
      domainClass: "architecture-tradeoff",
      evidenceGrade: "A",
      confidenceWeight: 0.9,
    });
  });

  it("re-running is idempotent and reports keptHigherTier for converged pages", async () => {
    const pages = [{ ...EA_PAGE, organizationId: null, abstract: EA_PAGE.abstract }];
    const { db } = makeFakeDb({ profiles: [EA_PROFILE], pages });

    const first = await backfillProfessionCraftMaterials(db, { loadFamilies: () => families });
    expect(first.promoted).toBe(1);

    // Second run rewrites at the same tier — still counted as promoted (upsert),
    // not keptHigherTier, because derived == derived is not a downgrade.
    const second = await backfillProfessionCraftMaterials(db, { loadFamilies: () => families });
    expect(second.promoted).toBe(1);
    expect(second.skipped).toHaveLength(0);
  });

  it("the decision-bearing kind registry stays closed", () => {
    expect(DECISION_BEARING_PAGE_KINDS).toEqual(["principle", "heuristic", "stance", "decision"]);
  });
});
