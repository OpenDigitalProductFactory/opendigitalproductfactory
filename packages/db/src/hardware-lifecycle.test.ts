import { describe, expect, it } from "vitest";

import {
  enrichHardwareIdentity,
  fetchWikidataDiscontinuation,
  hardwareReleaseToMilestones,
  parseWikidataTime,
  type HardwareLifecycleMilestone,
} from "./hardware-lifecycle";
import type { EolRelease } from "./endoflife-lifecycle";

describe("hardwareReleaseToMilestones", () => {
  it("maps discontinued→end_of_sale, eol→eol, eoes→eosl, releaseDate→release", () => {
    const release: EolRelease = {
      name: "R750",
      releaseDate: "2021-03-01",
      discontinuedFrom: "2026-01-01",
      eolFrom: "2029-03-01",
      eoesFrom: "2031-03-01",
    };
    const milestones = hardwareReleaseToMilestones(release);
    expect(milestones).toEqual([
      { milestone: "release", date: "2021-03-01", source: "endoflife.date", confidence: 0.9 },
      { milestone: "end_of_sale", date: "2026-01-01", source: "endoflife.date", confidence: 0.9 },
      { milestone: "eol", date: "2029-03-01", source: "endoflife.date", confidence: 0.9 },
      { milestone: "eosl", date: "2031-03-01", source: "endoflife.date", confidence: 0.9 },
    ]);
  });

  it("emits only dated milestones (no field never overwrites a known one)", () => {
    expect(hardwareReleaseToMilestones({ eolFrom: "2030-01-01" })).toEqual([
      { milestone: "eol", date: "2030-01-01", source: "endoflife.date", confidence: 0.9 },
    ]);
    expect(hardwareReleaseToMilestones({})).toEqual([]);
  });
});

describe("parseWikidataTime", () => {
  it("extracts YYYY-MM-DD from a Wikidata time literal", () => {
    expect(parseWikidataTime("+2019-09-10T00:00:00Z")).toBe("2019-09-10");
    expect(parseWikidataTime("-0044-03-15T00:00:00Z")).toBe("0044-03-15");
    expect(parseWikidataTime(null)).toBeNull();
    expect(parseWikidataTime("garbage")).toBeNull();
  });
});

function wikidataStub(entityId: string | null, time: string | null): typeof fetch {
  return (async (url: string) => {
    if (url.includes("wbsearchentities")) {
      return { ok: true, json: async () => ({ search: entityId ? [{ id: entityId }] : [] }) } as unknown as Response;
    }
    if (url.includes("wbgetclaims")) {
      return {
        ok: true,
        json: async () => ({
          claims: time ? { P2669: [{ mainsnak: { datavalue: { value: { time } } } }] } : {},
        }),
      } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("fetchWikidataDiscontinuation", () => {
  it("resolves the top entity's P2669 discontinuation date", async () => {
    const date = await fetchWikidataDiscontinuation("Apple", "iPhone 12", wikidataStub("Q78030975", "+2023-09-12T00:00:00Z"));
    expect(date).toBe("2023-09-12");
  });

  it("returns null when there is no matching entity", async () => {
    expect(await fetchWikidataDiscontinuation("Acme", "Nonesuch", wikidataStub(null, null))).toBeNull();
  });

  it("returns null when the entity has no P2669 claim", async () => {
    expect(await fetchWikidataDiscontinuation("Dell", "PowerEdge R750", wikidataStub("Q1", null))).toBeNull();
  });
});

function eolHardwareStub(): typeof fetch {
  return (async (url: string) => {
    if (typeof url === "string" && url.includes("/products/poweredge-r750/")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            name: "poweredge-r750",
            releases: [{ name: "R750", releaseDate: "2021-03-01", discontinuedFrom: "2026-01-01", eolFrom: "2029-03-01" }],
          },
        }),
      } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("enrichHardwareIdentity", () => {
  const identity = { id: "ci-r750", manufacturer: "Dell", product: "PowerEdge R750", productVersion: null };

  it("writes endoflife hardware + wikidata milestones, keyed per source", async () => {
    const upserts: HardwareLifecycleMilestone[] = [];
    const db = {
      catalogLifecycleMilestone: {
        upsert: async ({ create }: { create: HardwareLifecycleMilestone }) => { upserts.push(create); return {}; },
      },
    };

    const r = await enrichHardwareIdentity(db, identity, {
      eolFetch: eolHardwareStub(),
      wikidataFetch: wikidataStub("Q_r750", "+2026-06-01T00:00:00Z"),
    });

    expect(r.eolMatched).toBe(true);
    expect(r.wikidataMatched).toBe(true);
    // endoflife release+end_of_sale+eol (3) + wikidata end_of_sale (1) = 4
    expect(r.milestonesWritten).toBe(4);
    // Both an endoflife.date and a wikidata end_of_sale row exist — sources not flattened.
    const endOfSale = upserts.filter((m) => m.milestone === "end_of_sale");
    expect(endOfSale.map((m) => m.source).sort()).toEqual(["endoflife.date", "wikidata"]);
    expect(endOfSale.find((m) => m.source === "wikidata")?.confidence).toBe(0.4);
  });

  it("skips wikidata entirely when no wikidata fetcher is supplied", async () => {
    const upserts: HardwareLifecycleMilestone[] = [];
    const db = {
      catalogLifecycleMilestone: {
        upsert: async ({ create }: { create: HardwareLifecycleMilestone }) => { upserts.push(create); return {}; },
      },
    };
    const r = await enrichHardwareIdentity(db, identity, { eolFetch: eolHardwareStub() });
    expect(r.wikidataMatched).toBe(false);
    expect(upserts.every((m) => m.source === "endoflife.date")).toBe(true);
  });

  it("returns no matches for an unknown hardware model", async () => {
    const db = { catalogLifecycleMilestone: { upsert: async () => ({}) } };
    const r = await enrichHardwareIdentity(
      db,
      { id: "ci-x", manufacturer: "Acme", product: "MysteryBox", productVersion: null },
      { eolFetch: eolHardwareStub(), wikidataFetch: wikidataStub(null, null) },
    );
    expect(r.eolMatched).toBe(false);
    expect(r.wikidataMatched).toBe(false);
    expect(r.milestonesWritten).toBe(0);
  });
});
