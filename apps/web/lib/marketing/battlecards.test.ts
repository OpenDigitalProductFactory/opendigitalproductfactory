import { describe, expect, it } from "vitest";
import {
  battlecardScopeWhere,
  buildCompetitiveMatrix,
  type BattlecardRow,
} from "./battlecards";

function card(overrides: Partial<BattlecardRow> & { competitorName: string }): BattlecardRow {
  return {
    battlecardId: `bc_${overrides.competitorName}`,
    digitalProductId: null,
    positioning: null,
    theirStrengths: [],
    theirWeaknesses: [],
    ourDifferentiators: [],
    winThemes: [],
    status: "active",
    ...overrides,
  };
}

describe("buildCompetitiveMatrix", () => {
  it("returns an empty matrix for no cards", () => {
    expect(buildCompetitiveMatrix([])).toEqual({
      competitors: [],
      differentiators: [],
      coverage: {},
      activeCount: 0,
      totalCount: 0,
    });
  });

  it("lists competitors sorted and builds the differentiator union", () => {
    const m = buildCompetitiveMatrix([
      card({ competitorName: "Zebra", ourDifferentiators: ["price", "support"] }),
      card({ competitorName: "Acme", ourDifferentiators: ["support", "speed"] }),
    ]);
    expect(m.competitors).toEqual(["Acme", "Zebra"]);
    expect(m.differentiators).toEqual(["price", "speed", "support"]);
    expect(m.coverage).toEqual({
      Zebra: ["price", "support"],
      Acme: ["support", "speed"],
    });
  });

  it("de-duplicates differentiators case-insensitively, keeping first casing", () => {
    const m = buildCompetitiveMatrix([
      card({ competitorName: "Acme", ourDifferentiators: ["Speed", "speed", " SPEED "] }),
    ]);
    expect(m.coverage["Acme"]).toEqual(["Speed"]);
    expect(m.differentiators).toEqual(["Speed"]);
  });

  it("excludes non-active cards from the matrix but counts them in totalCount", () => {
    const m = buildCompetitiveMatrix([
      card({ competitorName: "Acme", ourDifferentiators: ["speed"] }),
      card({ competitorName: "OldCo", status: "archived", ourDifferentiators: ["legacy"] }),
    ]);
    expect(m.competitors).toEqual(["Acme"]);
    expect(m.differentiators).toEqual(["speed"]);
    expect(m.activeCount).toBe(1);
    expect(m.totalCount).toBe(2);
  });

  it("drops blank entries when normalizing", () => {
    const m = buildCompetitiveMatrix([
      card({ competitorName: "Acme", ourDifferentiators: ["", "  ", "real"] }),
    ]);
    expect(m.coverage["Acme"]).toEqual(["real"]);
  });
});

describe("battlecardScopeWhere", () => {
  it("distinguishes all, organization-wide, and product-specific views", () => {
    expect(battlecardScopeWhere({ organizationId: "org-1" })).toEqual({
      organizationId: "org-1",
    });
    expect(
      battlecardScopeWhere({
        organizationId: "org-1",
        digitalProductId: null,
      }),
    ).toEqual({
      organizationId: "org-1",
      digitalProductId: null,
    });
    expect(
      battlecardScopeWhere({
        organizationId: "org-1",
        digitalProductId: "digital-1",
      }),
    ).toEqual({
      organizationId: "org-1",
      digitalProductId: "digital-1",
    });
  });
});
