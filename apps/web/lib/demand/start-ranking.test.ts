// BI-78540D2C — the governed tee-up and the capacity drain start work by demand,
// not by age. These pin the shared ranking: score order, the unscored fallback
// (ranked after every scored item and said so), the age tie-break, and the
// investment-bucket preference when targets are set.
import { describe, expect, it } from "vitest";
import { rankForStart, type StartRankingCandidate } from "./start-ranking";

function item(overrides: Partial<StartRankingCandidate> & { itemId: string }): StartRankingCandidate {
  return {
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    demandScore: null,
    demandScoreFramework: null,
    investmentBucket: null,
    workType: null,
    effortSize: "medium",
    epic: null,
    ...overrides,
  };
}

const ids = (ranked: Array<{ item: StartRankingCandidate }>) => ranked.map((r) => r.item.itemId);

describe("rankForStart", () => {
  it("orders scored items by demand score, highest first, regardless of age", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-OLD-LOW", demandScore: 2, demandScoreFramework: "rice", createdAt: new Date("2026-01-01") }),
        item({ itemId: "BI-NEW-HIGH", demandScore: 40, demandScoreFramework: "rice", createdAt: new Date("2026-09-30") }),
        item({ itemId: "BI-MID", demandScore: 12, demandScoreFramework: "rice", createdAt: new Date("2026-05-01") }),
      ],
      3,
    );
    expect(ids(ranked)).toEqual(["BI-NEW-HIGH", "BI-MID", "BI-OLD-LOW"]);
    expect(ranked[0]!.scored).toBe(true);
    expect(ranked[0]!.reason).toContain("demand score 40 (rice)");
    expect(ranked[0]!.reason).toContain("1 of 3");
  });

  it("ranks an unscored item after every scored one, even when it is older, and says so", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-ANCIENT-UNSCORED", createdAt: new Date("2025-01-01") }),
        item({ itemId: "BI-SCORED", demandScore: 0.5, demandScoreFramework: "wsjf", createdAt: new Date("2026-09-30") }),
      ],
      2,
    );
    expect(ids(ranked)).toEqual(["BI-SCORED", "BI-ANCIENT-UNSCORED"]);
    const unscored = ranked[1]!;
    expect(unscored.scored).toBe(false);
    expect(unscored.reason).toMatch(/no demand score/i);
    expect(unscored.reason).toMatch(/after 1 scored/i);
  });

  it("says plainly when no eligible item is scored, rather than silently using age", () => {
    const ranked = rankForStart([item({ itemId: "BI-A" }), item({ itemId: "BI-B" })], 1);
    expect(ranked[0]!.reason).toMatch(/no eligible item has a demand score/i);
  });

  it("breaks a score tie on active epic, then oldest first, then item id", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-TIE-NEW", demandScore: 10, createdAt: new Date("2026-09-02") }),
        item({ itemId: "BI-TIE-OLD", demandScore: 10, createdAt: new Date("2026-09-01") }),
        item({ itemId: "BI-TIE-EPIC", demandScore: 10, createdAt: new Date("2026-09-03"), epic: { status: "in-progress" } }),
        item({ itemId: "BI-TIE-B", demandScore: 10, createdAt: new Date("2026-09-04") }),
        item({ itemId: "BI-TIE-A", demandScore: 10, createdAt: new Date("2026-09-04") }),
      ],
      5,
    );
    expect(ids(ranked)).toEqual(["BI-TIE-EPIC", "BI-TIE-OLD", "BI-TIE-NEW", "BI-TIE-A", "BI-TIE-B"]);
  });

  it("orders unscored items among themselves by active epic, then age", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-BOOT-OLDER", createdAt: new Date("2026-04-24T12:00:00Z") }),
        item({ itemId: "BI-EPIC-NEWER", createdAt: new Date("2026-04-24T13:00:00Z"), epic: { status: "open" } }),
        item({ itemId: "BI-EPIC-OLDER", createdAt: new Date("2026-04-24T11:00:00Z"), epic: { status: "in-progress" } }),
      ],
      3,
    );
    expect(ids(ranked)).toEqual(["BI-EPIC-OLDER", "BI-EPIC-NEWER", "BI-BOOT-OLDER"]);
  });

  it("treats a non-finite score as unscored", () => {
    const ranked = rankForStart(
      [item({ itemId: "BI-NAN", demandScore: Number.NaN }), item({ itemId: "BI-REAL", demandScore: 1 })],
      2,
    );
    expect(ids(ranked)).toEqual(["BI-REAL", "BI-NAN"]);
    expect(ranked[1]!.scored).toBe(false);
  });

  it("returns nothing for a zero limit and caps at the limit", () => {
    const pool = [item({ itemId: "BI-1", demandScore: 3 }), item({ itemId: "BI-2", demandScore: 2 })];
    expect(rankForStart(pool, 0)).toEqual([]);
    expect(ids(rankForStart(pool, 1))).toEqual(["BI-1"]);
  });

  it("ignores investment buckets when no targets are set", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-RUN-HIGH", demandScore: 9, investmentBucket: "run" }),
        item({ itemId: "BI-TRANSFORM-LOW", demandScore: 1, investmentBucket: "transform" }),
      ],
      2,
      { bucketTargets: null, inFlight: [{ investmentBucket: "run", workType: null, weight: 30 }] },
    );
    expect(ids(ranked)).toEqual(["BI-RUN-HIGH", "BI-TRANSFORM-LOW"]);
  });

  it("prefers a scored item in a starved bucket when targets are set, and records why", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-RUN-HIGH", demandScore: 9, investmentBucket: "run" }),
        item({ itemId: "BI-TRANSFORM-LOW", demandScore: 1, investmentBucket: "transform" }),
      ],
      2,
      {
        bucketTargets: { run: 70, grow: 20, transform: 10 },
        // Everything in flight is Run work, so Grow and Transform are starved.
        inFlight: [{ investmentBucket: "run", workType: null, weight: 30 }],
      },
    );
    expect(ids(ranked)).toEqual(["BI-TRANSFORM-LOW", "BI-RUN-HIGH"]);
    expect(ranked[0]!.reason).toMatch(/transform bucket is below its target/i);
  });

  it("never lets a starved bucket lift an unscored item over a scored one", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-RUN-SCORED", demandScore: 9, investmentBucket: "run" }),
        item({ itemId: "BI-TRANSFORM-UNSCORED", investmentBucket: "transform" }),
      ],
      2,
      { bucketTargets: { run: 70, grow: 20, transform: 10 }, inFlight: [{ investmentBucket: "run", workType: null, weight: 30 }] },
    );
    expect(ids(ranked)).toEqual(["BI-RUN-SCORED", "BI-TRANSFORM-UNSCORED"]);
  });

  it("re-reads the bucket balance after each pick so one starved bucket does not take every slot", () => {
    const ranked = rankForStart(
      [
        item({ itemId: "BI-T1", demandScore: 2, investmentBucket: "transform", effortSize: "large" }),
        item({ itemId: "BI-T2", demandScore: 1, investmentBucket: "transform", effortSize: "large" }),
        item({ itemId: "BI-RUN", demandScore: 5, investmentBucket: "run", effortSize: "small" }),
      ],
      2,
      { bucketTargets: { run: 70, grow: 20, transform: 10 }, inFlight: [{ investmentBucket: "run", workType: null, weight: 10 }] },
    );
    // T1 lifts Transform from 0% to 8/18 = 44% (over its 10% target) and drops
    // Run to 56% (under its 70%), so Run work goes next rather than T2.
    expect(ids(ranked)).toEqual(["BI-T1", "BI-RUN"]);
  });
});
