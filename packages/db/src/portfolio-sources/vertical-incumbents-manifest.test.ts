import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import {
  CONNECTOR_TIERS,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_TIER,
  VERTICAL_ARCHETYPES,
  VERTICAL_INCUMBENTS,
  archetypeIdsForVertical,
  connectorTierForCategory,
  isConnectorTier,
  isIntegrationCategory,
  isVerticalKey,
} from "./vertical-incumbents-manifest.js";

// P0 parity test (BI-513AE505). The manifest is the canonical structured home
// for the ~100 boundary-map incumbents (spec §8). These assertions keep it
// internally consistent and — critically — pinned to the REAL archetype set, so
// a renamed/removed archetype fails CI instead of silently orphaning postures.

const VALID_ARCHETYPE_IDS = new Set(ALL_ARCHETYPES.map((a) => a.archetypeId));

describe("vertical-incumbents manifest", () => {
  it("holds the full ~100-provider inventory", () => {
    // 19 verticals × their named incumbents (spec §6.2). Guards against an
    // accidental truncation of the list.
    expect(VERTICAL_INCUMBENTS.length).toBeGreaterThanOrEqual(100);
  });

  it("has no duplicate (providerName, integrationCategory) pair", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const p of VERTICAL_INCUMBENTS) {
      const key = `${p.providerName}::${p.integrationCategory}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
  });

  it("every provider uses a valid, closed integrationCategory", () => {
    for (const p of VERTICAL_INCUMBENTS) {
      expect(isIntegrationCategory(p.integrationCategory), p.providerName).toBe(true);
    }
  });

  it("every provider uses a valid verticalKey", () => {
    for (const p of VERTICAL_INCUMBENTS) {
      expect(isVerticalKey(p.verticalKey), p.providerName).toBe(true);
    }
  });

  it("every integrationCategory maps to a valid connector tier", () => {
    for (const category of INTEGRATION_CATEGORIES) {
      const tier = connectorTierForCategory(category);
      expect(isConnectorTier(tier), category).toBe(true);
      expect(INTEGRATION_CATEGORY_TIER[category]).toBe(tier);
    }
  });

  it("exposes all three tiers with at least one category each", () => {
    for (const tier of CONNECTOR_TIERS) {
      const categories = INTEGRATION_CATEGORIES.filter(
        (c) => connectorTierForCategory(c) === tier,
      );
      expect(categories.length, tier).toBeGreaterThan(0);
    }
  });

  it("every archetypeId in VERTICAL_ARCHETYPES exists in ALL_ARCHETYPES", () => {
    const orphans: string[] = [];
    for (const ids of Object.values(VERTICAL_ARCHETYPES)) {
      for (const id of ids) {
        if (!VALID_ARCHETYPE_IDS.has(id)) orphans.push(id);
      }
    }
    expect(orphans, `orphaned archetypeIds: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every vertical named by a provider has an archetype mapping", () => {
    for (const p of VERTICAL_INCUMBENTS) {
      const ids = archetypeIdsForVertical(p.verticalKey);
      expect(ids.length, p.verticalKey).toBeGreaterThan(0);
    }
  });

  it("every declared vertical is exercised by at least one provider", () => {
    const usedVerticals = new Set(VERTICAL_INCUMBENTS.map((p) => p.verticalKey));
    for (const vertical of Object.keys(VERTICAL_ARCHETYPES)) {
      expect(usedVerticals.has(vertical as never), vertical).toBe(true);
    }
  });

  it("covers the tier-1 shared categories the spec calls out (spec §6.1)", () => {
    const tier1 = INTEGRATION_CATEGORIES.filter(
      (c) => connectorTierForCategory(c) === "tier1-shared",
    );
    for (const expected of [
      "payments",
      "calendar",
      "messaging",
      "documents",
      "accounting",
      "crm",
      "inventory",
    ]) {
      expect(tier1).toContain(expected);
    }
  });
});
