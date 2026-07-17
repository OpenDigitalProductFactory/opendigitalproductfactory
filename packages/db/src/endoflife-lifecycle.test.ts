import { describe, expect, it } from "vitest";
import {
  releaseToMilestones,
  selectRelease,
  upsertLifecycleForIdentity,
  type EolProduct,
  type LifecycleUpsertClient,
} from "./endoflife-lifecycle";

const postgres: EolProduct = {
  name: "postgresql",
  releases: [
    { name: "16", releaseDate: "2023-09-14", isEol: false, eolFrom: "2028-11-09", eoasFrom: null, eoesFrom: null },
    { name: "11", releaseDate: "2018-10-18", isEol: true, eolFrom: "2023-11-09", eoasFrom: "2021-11-11", eoesFrom: null },
  ],
};

describe("releaseToMilestones", () => {
  it("maps endoflife.date dates onto CatalogLifecycleMilestone milestones, skipping undated ones", () => {
    expect(releaseToMilestones(postgres.releases[1]!)).toEqual([
      { milestone: "release", date: "2018-10-18" },
      { milestone: "mainstream_end", date: "2021-11-11" },
      { milestone: "eol", date: "2023-11-09" },
    ]);
  });

  it("emits only the dates that are present", () => {
    expect(releaseToMilestones({ releaseDate: "2023-09-14", eolFrom: "2028-11-09" })).toEqual([
      { milestone: "release", date: "2023-09-14" },
      { milestone: "eol", date: "2028-11-09" },
    ]);
    expect(releaseToMilestones({})).toEqual([]);
  });
});

describe("selectRelease", () => {
  it("prefers an exact version match, then the release line prefix, then the latest", () => {
    expect(selectRelease(postgres, "11")?.name).toBe("11");
    expect(selectRelease(postgres, "16.2")?.name).toBe("16"); // prefix → the 16 line
    expect(selectRelease(postgres, "99")?.name).toBe("16"); // no match → latest
    expect(selectRelease(postgres, null)?.name).toBe("16");
    expect(selectRelease({ name: "x", releases: [] }, "1")).toBeNull();
  });
});

describe("upsertLifecycleForIdentity", () => {
  it("upserts one milestone per dated field, keyed on (identity, milestone, source=endoflife.date)", async () => {
    const upserts: Array<{ where: unknown; create: { milestone: string; source: string } }> = [];
    const db: LifecycleUpsertClient = {
      catalogLifecycleMilestone: {
        upsert: async (args: unknown) => {
          upserts.push(args as { where: unknown; create: { milestone: string; source: string } });
          return {};
        },
      },
    };

    const written = await upsertLifecycleForIdentity(db, "ci_postgres", postgres, "11");

    expect(written).toBe(3);
    expect(upserts.map((u) => u.create.milestone)).toEqual(["release", "mainstream_end", "eol"]);
    for (const u of upserts) {
      expect(u.create.source).toBe("endoflife.date");
      expect(u.where).toEqual({
        catalogIdentityId_milestone_source: {
          catalogIdentityId: "ci_postgres",
          milestone: u.create.milestone,
          source: "endoflife.date",
        },
      });
    }
  });

  it("writes nothing when the product has no releases", async () => {
    let calls = 0;
    const db: LifecycleUpsertClient = {
      catalogLifecycleMilestone: { upsert: async () => ((calls += 1), {}) },
    };
    expect(await upsertLifecycleForIdentity(db, "ci_x", { name: "x", releases: [] })).toBe(0);
    expect(calls).toBe(0);
  });
});
