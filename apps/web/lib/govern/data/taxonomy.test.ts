// apps/web/lib/govern/data/taxonomy.test.ts
import { describe, expect, it } from "vitest";
import {
  ALL_DATA_ACTIONS,
  ALL_DATA_CATEGORIES,
  ALL_DATA_PEP_KINDS,
  ALL_DATA_SENSITIVITIES,
  ALL_LIFECYCLE_CLASSES,
  ALL_PROJECTION_CLASSES,
  EFFECT_RANK,
  PRECEDENCE_ORDER,
  isDataAssetId,
  isDataFieldId,
  makeDataAssetId,
  makeDataFieldId,
  parseDataFieldId,
  precedenceRank,
  type DataEffect,
} from "./taxonomy";

describe("stable logical identifiers", () => {
  it("builds and round-trips a field id through its asset id and local name", () => {
    const asset = makeDataAssetId("customer-account");
    expect(asset).toBe("data:customer-account");
    const field = makeDataFieldId(asset, "emailAddress");
    expect(field).toBe("data:customer-account#emailAddress");
    expect(parseDataFieldId(field)).toEqual({
      assetId: "data:customer-account",
      localName: "emailAddress",
    });
  });

  it("validates well-formed ids and rejects malformed ones", () => {
    expect(isDataAssetId("data:customer-account")).toBe(true);
    expect(isDataAssetId("customer-account")).toBe(false);
    expect(isDataAssetId("data:Customer")).toBe(false); // no uppercase in slug
    expect(isDataFieldId("data:x#emailAddress")).toBe(true);
    expect(isDataFieldId("data:x")).toBe(false); // no field segment
  });

  it("rejects invalid slugs and field names at construction", () => {
    expect(() => makeDataAssetId("Bad Slug")).toThrow();
    expect(() => makeDataFieldId(makeDataAssetId("x"), "1bad")).toThrow();
  });
});

describe("closed vocabularies", () => {
  const closedSets: Record<string, readonly string[]> = {
    sensitivities: ALL_DATA_SENSITIVITIES,
    categories: ALL_DATA_CATEGORIES,
    lifecycle: ALL_LIFECYCLE_CLASSES,
    projection: ALL_PROJECTION_CLASSES,
    actions: ALL_DATA_ACTIONS,
    peps: ALL_DATA_PEP_KINDS,
  };

  it("has no duplicate members in any closed set", () => {
    for (const [name, members] of Object.entries(closedSets)) {
      expect(new Set(members).size, `duplicate member in ${name}`).toBe(members.length);
    }
  });

  it("keeps sensitivity aligned with the route/agent taxonomy", () => {
    expect([...ALL_DATA_SENSITIVITIES]).toEqual([
      "public",
      "internal",
      "confidential",
      "restricted",
    ]);
  });

  it("keeps projection classes aligned with the derived-data payload classes (spec §6.4)", () => {
    expect([...ALL_PROJECTION_CLASSES]).toEqual([
      "structure",
      "metadata",
      "masked-content",
      "content",
    ]);
  });
});

describe("precedence lattice", () => {
  it("ranks deny/review above allow so ambiguity never becomes allow", () => {
    const effects: DataEffect[] = ["allow", "allow-with-obligations", "review", "deny"];
    const strongest = effects.reduce((a, b) => (EFFECT_RANK[b] > EFFECT_RANK[a] ? b : a));
    expect(strongest).toBe("deny");
    expect(EFFECT_RANK.deny).toBeGreaterThan(EFFECT_RANK.review);
    expect(EFFECT_RANK.review).toBeGreaterThan(EFFECT_RANK["allow-with-obligations"]);
    expect(EFFECT_RANK["allow-with-obligations"]).toBeGreaterThan(EFFECT_RANK.allow);
  });

  it("orders precedence levels with hard constraints strongest", () => {
    expect(PRECEDENCE_ORDER[0]).toBe("hard-constraint");
    expect(precedenceRank("hard-constraint")).toBeLessThan(precedenceRank("mandatory-authority"));
    expect(precedenceRank("mandatory-authority")).toBeLessThan(precedenceRank("approved-exception"));
  });
});
