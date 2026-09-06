import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreWikiPageInput } from "@/lib/wiki/embeddings";
import {
  seedOrgWwwdCorpus,
  ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
  type SeedOrgWwwdClient,
} from "./seed-org-wwwd-corpus";

type EmbedFn = (input: StoreWikiPageInput) => Promise<boolean>;

// ─── In-memory fake of the Prisma surface the seeder touches ────────────────
// Implements upsert/findFirst/create/update with real keyed semantics so the
// idempotency assertions are meaningful (re-runs must not duplicate rows).

type Row = Record<string, any>;

function makeFakeDb(opts: {
  businessContext: Row | null;
  archetype: { name: string; category: string } | null;
  orgName: string | null;
}) {
  const profiles: Row[] = [];
  const versions: Row[] = [];
  const materials: Row[] = [];
  const wikiPages: Row[] = [];
  const revisions: Row[] = [];

  let pageSeq = 0;

  function upsertBy(coll: Row[], key: string, value: string, create: Row, update: Row): Row {
    const found = coll.find((r) => r[key] === value);
    if (found) {
      Object.assign(found, update);
      return found;
    }
    const row = { ...create };
    coll.push(row);
    return row;
  }

  const db: SeedOrgWwwdClient = {
    businessContext: {
      findUnique: vi.fn(async () => opts.businessContext),
    },
    storefrontConfig: {
      findFirst: vi.fn(async () => (opts.archetype ? { archetype: opts.archetype } : null)),
    },
    organization: {
      findUnique: vi.fn(async () => ({ name: opts.orgName })),
    },
    decisionPerspectiveProfile: {
      upsert: vi.fn(async (args: any) =>
        upsertBy(profiles, "profileId", args.where.profileId, args.create, args.update),
      ),
      update: vi.fn(async (args: any) => {
        const found = profiles.find((r) => r.profileId === args.where.profileId);
        if (found) Object.assign(found, args.data);
        return found;
      }),
    },
    decisionPerspectiveProfileVersion: {
      upsert: vi.fn(async (args: any) =>
        upsertBy(versions, "versionId", args.where.versionId, args.create, args.update),
      ),
    },
    perspectiveMaterial: {
      upsert: vi.fn(async (args: any) =>
        upsertBy(materials, "materialId", args.where.materialId, args.create, args.update),
      ),
    },
    wikiPage: {
      findFirst: vi.fn(async (args: any) => {
        const { organizationId, slug } = args.where;
        return (
          wikiPages.find((r) => r.organizationId === organizationId && r.slug === slug) ?? null
        );
      }),
      create: vi.fn(async (args: any) => {
        const row = { id: `wp_${++pageSeq}`, ...args.data };
        wikiPages.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const found = wikiPages.find((r) => r.id === args.where.id);
        if (found) Object.assign(found, args.data);
        return found;
      }),
    },
    wikiPageRevision: {
      findFirst: vi.fn(async (args: any) => {
        const rev = revisions
          .filter((r) => r.pageId === args.where.pageId)
          .sort((a, b) => b.version - a.version)[0];
        return rev ?? null;
      }),
      create: vi.fn(async (args: any) => {
        revisions.push({ ...args.data });
        return args.data;
      }),
    },
  };

  return { db, profiles, versions, materials, wikiPages, revisions };
}

const ORG = "org_123";

describe("seedOrgWwwdCorpus", () => {
  let embed: ReturnType<typeof vi.fn<EmbedFn>>;

  beforeEach(() => {
    embed = vi.fn<EmbedFn>(async () => true);
  });

  it("seeds the org profile, v1 version, materials, and published org wiki pages", async () => {
    const fake = makeFakeDb({
      businessContext: {
        mission: "Help local families breathe easier.",
        description: "We install and service home HVAC systems.",
        targetMarket: "homeowners in the tri-county area",
        industry: "trades-field-service",
      },
      archetype: { name: "HVAC Contractor", category: "trades-field-service" },
      orgName: "Dale's Heating & Air",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    // Profile containers: the platform fallback row (FK target, seeded first
    // so the org profile's fallbackProfileId FK cannot violate) + the org row.
    expect(result.profileId).toBe(`org-perspective-${ORG}`);
    expect(fake.profiles).toHaveLength(2);
    expect(fake.profiles[0]).toMatchObject({
      profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      kind: "organization",
      fallbackProfileId: null,
    });
    expect(fake.profiles[1]).toMatchObject({
      kind: "organization",
      ownerOrganizationId: ORG,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      currentVersionId: result.versionId,
    });

    // Version v1
    // Fallback profile v1 + org v1 (BI-218EC195: the fallback carries its own version).
    expect(fake.versions).toHaveLength(2);
    expect(fake.versions[1]).toMatchObject({ versionId: result.versionId, versionNumber: 1 });

    // Thirteen materials across all four decision classes (BI-70ADC71F + the
    // workstream-B excellence page in plan-readiness).
    expect(result.materialCount).toBe(13);
    expect(fake.materials).toHaveLength(13);
    for (const m of fake.materials) {
      expect(m.profileVersionId).toBe(result.versionId);
      expect(m.reviewStatus).toBe("approved");
      expect(m.promotionState).toBe("promoted");
      expect(m.evidenceGrade).toBe("B");
      expect(m.confidenceWeight).toBe(0.6);
      expect(m.sourceRef.wikiPageId).toBeTruthy();
    }
    const byClass = fake.materials.reduce<Record<string, number>>((acc, m) => {
      acc[m.domainClass] = (acc[m.domainClass] ?? 0) + 1;
      return acc;
    }, {});
    expect(byClass).toEqual({
      "plan-readiness": 5,
      "risk-assessment": 3,
      "professional-practice": 3,
      "architecture-tradeoff": 2,
    });

    // Ten published, org-scoped, non-kernel wiki pages (4 identity + 1 excellence + 5 vectors)
    expect(fake.wikiPages).toHaveLength(10);
    for (const p of fake.wikiPages) {
      expect(p.status).toBe("published");
      expect(p.organizationId).toBe(ORG);
      expect(p.isKernel).toBe(false);
    }
    expect(fake.wikiPages.map((p) => p.slug).sort()).toEqual([
      "org-how-we-decide",
      "org-mission",
      "org-supply-chain",
      "org-what-great-looks-like",
      "org-who-we-serve",
      "stances/customer-goodwill",
      "stances/growth-vs-stability",
      "stances/pricing-integrity",
      "stances/quality-bar",
      "stances/spend-authority",
    ]);

    // Captured mission lands in the mission page body
    const mission = fake.wikiPages.find((p) => p.slug === "org-mission");
    expect(mission).toBeDefined();
    expect(mission!.body).toContain("Help local families breathe easier.");
    expect(mission!.pageKind).toBe("principle");

    // Every published page was embedded into Qdrant
    expect(embed).toHaveBeenCalledTimes(10);
    expect(result.embedded).toBe(true);
    expect(result.wikiPageIds).toHaveLength(10);
  });

  it("is idempotent — re-running produces no duplicate profile/version/material/page rows", async () => {
    const fake = makeFakeDb({
      businessContext: {
        mission: "Help local families breathe easier.",
        description: "HVAC",
        targetMarket: "homeowners",
        industry: "trades-field-service",
      },
      archetype: { name: "HVAC Contractor", category: "trades-field-service" },
      orgName: "Dale's",
    });

    await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });
    await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    // Fallback + org profile, each upserted once (no duplicates on re-run).
    expect(fake.profiles).toHaveLength(2);
    expect(fake.versions).toHaveLength(2);
    expect(fake.materials).toHaveLength(13);
    expect(fake.wikiPages).toHaveLength(10);
    // Body unchanged on the 2nd run → no extra revision, no re-embed
    expect(fake.revisions).toHaveLength(10);
    expect(embed).toHaveBeenCalledTimes(10);
  });

  it("still seeds a non-empty corpus when no mission was captured (archetype fallback)", async () => {
    const fake = makeFakeDb({
      businessContext: { mission: null, description: null, targetMarket: null, industry: "healthcare-wellness" },
      archetype: { name: "Dental Practice", category: "healthcare-wellness" },
      orgName: "Bright Smiles",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    expect(result.materialCount).toBe(13);
    const mission = fake.wikiPages.find((p) => p.slug === "org-mission");
    expect(mission).toBeDefined();
    expect(mission!.body.trim().length).toBeGreaterThan(20);
    expect(mission!.abstract.toLowerCase()).toContain("care"); // healthcare theme
  });

  it("reports embedded=false when the embed step fails (fail-open)", async () => {
    const fake = makeFakeDb({
      businessContext: { mission: "M", description: null, targetMarket: null, industry: null },
      archetype: null,
      orgName: null,
    });
    const failing = vi.fn<EmbedFn>(async () => false);

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed: failing });

    expect(result.embedded).toBe(false);
    // DB rows still created despite embedding failure
    expect(fake.wikiPages).toHaveLength(10);
    expect(fake.materials).toHaveLength(13);
  });

  it("seeds an archetype-aware org-supply-chain stance page + material", async () => {
    // Food-hospitality industry → its profile.supplyChain should drive the
    // page body (perishables / cold-chain / local-supplier posture).
    const fake = makeFakeDb({
      businessContext: {
        mission: "Feed our neighbourhood food worth coming back for.",
        description: "We run a small neighbourhood restaurant.",
        targetMarket: "locals and regulars",
        industry: "food-hospitality",
      },
      archetype: { name: "Restaurant", category: "food-hospitality" },
      orgName: "Corner Kitchen",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    const page = fake.wikiPages.find((p) => p.slug === "org-supply-chain");
    expect(page).toBeDefined();
    expect(page!.pageKind).toBe("stance");
    expect(page!.status).toBe("published");
    expect(page!.organizationId).toBe(ORG);
    expect(page!.isKernel).toBe(false);
    // Page body reflects food-hospitality's characteristic supply posture.
    expect(page!.body.toLowerCase()).toMatch(/perish|cold[- ]chain|local/);
    expect(page!.abstract.trim().length).toBeGreaterThan(20);

    // Material follows the same linkage pattern as the other seeded materials.
    const material = fake.materials.find((m) => m.materialId === `${result.profileId}:org-supply-chain`);
    expect(material).toBeDefined();
    expect(material!.sourceType).toBe("stance");
    // Retagged (BI-70ADC71F): supplier posture governs structural vendor choices.
    expect(material!.domainClass).toBe("architecture-tradeoff");
    expect(material!.direction).toBe("support");
    expect(material!.evidenceGrade).toBe("B");
    expect(material!.reviewStatus).toBe("approved");
    expect(material!.promotionState).toBe("promoted");
    expect(material!.sourceRef.wikiPageId).toBe(page!.id);
    expect(material!.sourceRef.slug).toBe("org-supply-chain");
    expect(material!.sourceRef.organizationId).toBe(ORG);
  });

  it("falls back to a brief generic supply-chain stance when the industry is unknown", async () => {
    const fake = makeFakeDb({
      businessContext: { mission: "M", description: null, targetMarket: null, industry: null },
      archetype: null,
      orgName: null,
    });

    await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    const page = fake.wikiPages.find((p) => p.slug === "org-supply-chain");
    expect(page).toBeDefined();
    expect(page!.body.trim().length).toBeGreaterThan(20);
    expect(page!.pageKind).toBe("stance");
    // Generic body is intentionally short / honest — no fabricated specifics.
    expect(page!.body.toLowerCase()).not.toMatch(/perish|cold[- ]chain|dropship/);
  });
});

describe("seedOrgWwwdCorpus stance vectors (BI-70ADC71F)", () => {
  it("seeds archetype-aware vector pages with the authority ceiling in the body", async () => {
    const embed = vi.fn<EmbedFn>(async () => true);
    const fake = makeFakeDb({
      businessContext: {
        mission: "Keep smiles healthy.",
        description: "A dental practice.",
        targetMarket: "families",
        industry: "healthcare-wellness",
      },
      archetype: { name: "Dental Practice", category: "healthcare-wellness" },
      orgName: "Bright Smiles",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    const goodwill = fake.wikiPages.find((p) => p.slug === "stances/customer-goodwill");
    expect(goodwill).toBeDefined();
    expect(goodwill!.pageKind).toBe("stance");
    expect(goodwill!.body).toMatch(/patient/i);
    expect(goodwill!.body).toContain("up to $150");

    // Goodwill bundles into risk-assessment (primary) + professional-practice (echo)
    const primary = fake.materials.find(
      (m) => m.materialId === `${result.profileId}:stances/customer-goodwill`,
    );
    const echo = fake.materials.find(
      (m) => m.materialId === `${result.profileId}:stances/customer-goodwill:professional-practice`,
    );
    expect(primary).toBeDefined();
    expect(primary!.domainClass).toBe("risk-assessment");
    expect(echo).toBeDefined();
    expect(echo!.domainClass).toBe("professional-practice");
    expect(echo!.sourceRef.wikiPageId).toBe(goodwill!.id);
  });

  it("re-seeding never downgrades an owner-confirmed material (update omits grade/weight/review)", async () => {
    const embed = vi.fn<EmbedFn>(async () => true);
    const fake = makeFakeDb({
      businessContext: { mission: "M", description: null, targetMarket: null, industry: "retail-goods" },
      archetype: { name: "Shop", category: "retail-goods" },
      orgName: "Shop",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    // Simulate the owner confirming the goodwill stance (Phase 2 upgrade).
    const confirmed = fake.materials.find(
      (m) => m.materialId === `${result.profileId}:stances/customer-goodwill`,
    )!;
    confirmed.evidenceGrade = "A";
    confirmed.confidenceWeight = 0.9;

    await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    expect(confirmed.evidenceGrade).toBe("A");
    expect(confirmed.confidenceWeight).toBe(0.9);
    // …while retag-relevant fields still refresh.
    expect(confirmed.freshness).toBe("current");
  });
});
