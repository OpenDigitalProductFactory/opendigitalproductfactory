import { describe, expect, it, vi } from "vitest";

import { decayStaleMaterials, type FreshnessDecayClient } from "./material-freshness";
import { scorePerspectiveMaterial } from "./material";
import type { PerspectiveMaterial } from "./types";

const NOW = new Date("2026-06-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

type Row = Record<string, any>;
function makeDb(rows: Row[]) {
  const updates: Row[] = [];
  const db = {
    perspectiveMaterial: {
      findMany: vi.fn(async () => rows.filter((r) => r.freshness === "current")),
      update: vi.fn(async (args: any) => {
        updates.push({ materialId: args.where.materialId, ...args.data });
        return args.data;
      }),
    },
  } as unknown as FreshnessDecayClient;
  return { db, updates };
}

describe("decayStaleMaterials", () => {
  it("ages researched/derived 'current' material past the window to 'stale'", async () => {
    const { db, updates } = makeDb([
      { materialId: "m_old_research", evidenceGrade: "C", freshness: "current", lastValidatedAt: daysAgo(120), createdAt: daysAgo(120) },
      { materialId: "m_recent_research", evidenceGrade: "C", freshness: "current", lastValidatedAt: daysAgo(10), createdAt: daysAgo(10) },
    ]);
    const res = await decayStaleMaterials({ now: NOW, stalenessWindowDays: 90, db });

    expect(res.staled).toBe(1);
    expect(updates).toEqual([{ materialId: "m_old_research", freshness: "stale" }]);
  });

  it("never auto-decays first-party (grade A) material", async () => {
    const { db, updates } = makeDb([
      { materialId: "m_first_party", evidenceGrade: "A", freshness: "current", lastValidatedAt: daysAgo(999), createdAt: daysAgo(999) },
    ]);
    const res = await decayStaleMaterials({ now: NOW, stalenessWindowDays: 90, db });
    expect(res.staled).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("falls back to createdAt when lastValidatedAt is null", async () => {
    const { db, updates } = makeDb([
      { materialId: "m_b", evidenceGrade: "B", freshness: "current", lastValidatedAt: null, createdAt: daysAgo(200) },
    ]);
    const res = await decayStaleMaterials({ now: NOW, stalenessWindowDays: 90, db });
    expect(res.staled).toBe(1);
    expect(updates[0].materialId).toBe("m_b");
  });
});

describe("scorePerspectiveMaterial — superseded exclusion (BI-06B2EC05)", () => {
  const base: PerspectiveMaterial = {
    materialId: "m1",
    profileId: "p1",
    sourceType: "stance",
    sourceRef: {},
    summary: "",
    domainClass: "plan-readiness",
    direction: "support",
    domains: ["plan-readiness"],
    freshness: "current",
    evidenceGrade: "B",
    confidenceWeight: 0.8,
    reviewStatus: "approved",
    promotionState: "promoted",
    lastValidatedAt: null,
  };

  it("excludes superseded material from decisions (weight 0), like contradicted", () => {
    const superseded = scorePerspectiveMaterial({ ...base, freshness: "superseded" });
    expect(superseded.effectiveWeight).toBe(0);
    expect(superseded.exclusionReason).toBe("superseded");
  });

  it("keeps stale material usable but down-weighted (not excluded)", () => {
    const stale = scorePerspectiveMaterial({ ...base, freshness: "stale" });
    expect(stale.effectiveWeight).toBeGreaterThan(0);
    expect(stale.exclusionReason).toBeNull();
  });
});
