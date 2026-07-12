import { describe, expect, it, vi } from "vitest";

import {
  promoteStanceMaterial,
  stanceMaterialId,
  STANCE_TIERS,
  type StancePromotionClient,
} from "./stance-promotion";

type Row = Record<string, any>;

function makeFakeDb(opts: { profile?: Row | null; materials?: Row[] }) {
  const materials: Row[] = opts.materials ?? [];
  const db: StancePromotionClient = {
    decisionPerspectiveProfile: {
      findFirst: vi.fn(async () => opts.profile ?? null),
    },
    perspectiveMaterial: {
      findUnique: vi.fn(async (args: any) => {
        const row = materials.find((m) => m.materialId === args.where.materialId);
        return row ?? null;
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
  };
  return { db, materials };
}

const ORG = "org_1";
const PROFILE = { profileId: "org-perspective-org_1", currentVersionId: "org-perspective-org_1-v1" };

describe("promoteStanceMaterial", () => {
  it("returns no-org-profile when the org has no WWWD profile", async () => {
    const { db } = makeFakeDb({ profile: null });
    const result = await promoteStanceMaterial({
      db,
      organizationId: ORG,
      wikiPageId: "wp1",
      slug: "stances/customer-goodwill",
      summary: "s",
      domainClasses: ["risk-assessment"],
      tier: "confirmed",
    });
    expect(result).toEqual({ ok: false, error: "no-org-profile" });
  });

  it("writes confirmed A/0.9 materials across the bundle (primary + echo ids)", async () => {
    const { db, materials } = makeFakeDb({ profile: PROFILE });
    const result = await promoteStanceMaterial({
      db,
      organizationId: ORG,
      wikiPageId: "wp1",
      slug: "stances/customer-goodwill",
      summary: "Make it right fast",
      domainClasses: ["risk-assessment", "professional-practice"],
      tier: "confirmed",
    });

    expect(result.ok).toBe(true);
    expect(materials).toHaveLength(2);
    expect(materials[0]).toMatchObject({
      materialId: "org-perspective-org_1:stances/customer-goodwill",
      domainClass: "risk-assessment",
      evidenceGrade: "A",
      confidenceWeight: 0.9,
      reviewStatus: "approved",
      promotionState: "promoted",
      direction: "support",
    });
    expect(materials[1]).toMatchObject({
      materialId: "org-perspective-org_1:stances/customer-goodwill:professional-practice",
      domainClass: "professional-practice",
      confidenceWeight: 0.9,
    });
  });

  it("upgrades an existing unconfirmed (B/0.6) seed row in place", async () => {
    const seeded = {
      materialId: "org-perspective-org_1:stances/quality-bar",
      evidenceGrade: "B",
      confidenceWeight: 0.6,
    };
    const { db, materials } = makeFakeDb({ profile: PROFILE, materials: [seeded] });

    const result = await promoteStanceMaterial({
      db,
      organizationId: ORG,
      wikiPageId: "wp2",
      slug: "stances/quality-bar",
      summary: "Meets our standard or we redo it",
      domainClasses: ["professional-practice"],
      tier: "confirmed",
    });

    expect(result.ok).toBe(true);
    expect(materials).toHaveLength(1);
    expect(materials[0].evidenceGrade).toBe("A");
    expect(materials[0].confidenceWeight).toBe(0.9);
  });

  it("NEVER downgrades: a ruled (A/1.0) row survives a confirmed (A/0.9) write", async () => {
    const ruled = {
      materialId: "org-perspective-org_1:stances/ruling-billing",
      evidenceGrade: "A",
      confidenceWeight: 1.0,
    };
    const { db, materials } = makeFakeDb({ profile: PROFILE, materials: [ruled] });

    const result = await promoteStanceMaterial({
      db,
      organizationId: ORG,
      wikiPageId: "wp3",
      slug: "stances/ruling-billing",
      summary: "s",
      domainClasses: ["risk-assessment"],
      tier: "confirmed",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keptHigherTier).toEqual(["org-perspective-org_1:stances/ruling-billing"]);
    }
    expect(materials[0].confidenceWeight).toBe(1.0);
  });

  it("ruled tier writes A/1.0 (the human-ruled ceiling)", async () => {
    const { db, materials } = makeFakeDb({ profile: PROFILE });
    await promoteStanceMaterial({
      db,
      organizationId: ORG,
      wikiPageId: "wp4",
      slug: "stances/ruling-x",
      summary: "s",
      domainClasses: ["risk-assessment"],
      tier: "ruled",
    });
    expect(materials[0].evidenceGrade).toBe("A");
    expect(materials[0].confidenceWeight).toBe(1.0);
  });

  it("tier table matches the design ladder", () => {
    expect(STANCE_TIERS.unconfirmed).toEqual({ evidenceGrade: "B", confidenceWeight: 0.6 });
    expect(STANCE_TIERS.confirmed).toEqual({ evidenceGrade: "A", confidenceWeight: 0.9 });
    expect(STANCE_TIERS.ruled).toEqual({ evidenceGrade: "A", confidenceWeight: 1.0 });
  });

  it("stanceMaterialId matches the seeder scheme", () => {
    expect(stanceMaterialId("p", "stances/x", "risk-assessment", true)).toBe("p:stances/x");
    expect(stanceMaterialId("p", "stances/x", "risk-assessment", false)).toBe(
      "p:stances/x:risk-assessment",
    );
  });
});
