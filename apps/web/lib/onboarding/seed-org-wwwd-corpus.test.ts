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

    // Profile container
    expect(result.profileId).toBe(`org-perspective-${ORG}`);
    expect(fake.profiles).toHaveLength(1);
    expect(fake.profiles[0]).toMatchObject({
      kind: "organization",
      ownerOrganizationId: ORG,
      fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
      currentVersionId: result.versionId,
    });

    // Version v1
    expect(fake.versions).toHaveLength(1);
    expect(fake.versions[0]).toMatchObject({ versionId: result.versionId, versionNumber: 1 });

    // Three materials, each linked to a wiki page + the version
    expect(result.materialCount).toBe(3);
    expect(fake.materials).toHaveLength(3);
    for (const m of fake.materials) {
      expect(m.profileVersionId).toBe(result.versionId);
      expect(m.domainClass).toBe("plan-readiness");
      expect(m.reviewStatus).toBe("approved");
      expect(m.promotionState).toBe("promoted");
      expect(m.sourceRef.wikiPageId).toBeTruthy();
    }

    // Three published, org-scoped, non-kernel wiki pages
    expect(fake.wikiPages).toHaveLength(3);
    for (const p of fake.wikiPages) {
      expect(p.status).toBe("published");
      expect(p.organizationId).toBe(ORG);
      expect(p.isKernel).toBe(false);
    }
    expect(fake.wikiPages.map((p) => p.slug).sort()).toEqual([
      "org-how-we-decide",
      "org-mission",
      "org-who-we-serve",
    ]);

    // Captured mission lands in the mission page body
    const mission = fake.wikiPages.find((p) => p.slug === "org-mission");
    expect(mission).toBeDefined();
    expect(mission!.body).toContain("Help local families breathe easier.");
    expect(mission!.pageKind).toBe("principle");

    // Every published page was embedded into Qdrant
    expect(embed).toHaveBeenCalledTimes(3);
    expect(result.embedded).toBe(true);
    expect(result.wikiPageIds).toHaveLength(3);
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

    expect(fake.profiles).toHaveLength(1);
    expect(fake.versions).toHaveLength(1);
    expect(fake.materials).toHaveLength(3);
    expect(fake.wikiPages).toHaveLength(3);
    // Body unchanged on the 2nd run → no extra revision, no re-embed
    expect(fake.revisions).toHaveLength(3);
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it("still seeds a non-empty corpus when no mission was captured (archetype fallback)", async () => {
    const fake = makeFakeDb({
      businessContext: { mission: null, description: null, targetMarket: null, industry: "healthcare-wellness" },
      archetype: { name: "Dental Practice", category: "healthcare-wellness" },
      orgName: "Bright Smiles",
    });

    const result = await seedOrgWwwdCorpus({ organizationId: ORG, db: fake.db, embed });

    expect(result.materialCount).toBe(3);
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
    expect(fake.wikiPages).toHaveLength(3);
    expect(fake.materials).toHaveLength(3);
  });
});
