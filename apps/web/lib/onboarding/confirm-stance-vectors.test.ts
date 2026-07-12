import { describe, expect, it } from "vitest";

import {
  classesCoveredByVectors,
  confirmedStanceBody,
  identityUpgradesForClasses,
  IDENTITY_PAGE_BUNDLES,
  validateConfirmStanceVectors,
} from "./confirm-stance-vectors";

describe("validateConfirmStanceVectors", () => {
  it("rejects unknown keys, duplicates, and too-short stances", () => {
    expect(
      validateConfirmStanceVectors({ vectors: [{ key: "nope" as never, stance: "x".repeat(30) }] }).ok,
    ).toBe(false);
    expect(
      validateConfirmStanceVectors({
        vectors: [
          { key: "quality-bar", stance: "x".repeat(30) },
          { key: "quality-bar", stance: "y".repeat(30) },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateConfirmStanceVectors({ vectors: [{ key: "quality-bar", stance: "short" }] }).ok,
    ).toBe(false);
  });

  it("normalizes ceilings (rounds, drops non-positive)", () => {
    const v = validateConfirmStanceVectors({
      vectors: [
        { key: "customer-goodwill", stance: "Make it right fast, every time we caused it.", ceilingUsd: 149.6 },
        { key: "quality-bar", stance: "Meets our standard or we redo it at our cost.", ceilingUsd: 0 },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.vectors[0].ceilingUsd).toBe(150);
      expect(v.vectors[1].ceilingUsd).toBeNull();
    }
  });
});

describe("classesCoveredByVectors / identityUpgradesForClasses", () => {
  it("confirming all 5 vectors covers all 4 classes and upgrades every identity page", () => {
    const covered = classesCoveredByVectors([
      "customer-goodwill",
      "pricing-integrity",
      "growth-vs-stability",
      "quality-bar",
      "spend-authority",
    ]);
    expect(covered.sort()).toEqual([
      "architecture-tradeoff",
      "plan-readiness",
      "professional-practice",
      "risk-assessment",
    ]);
    const upgrades = identityUpgradesForClasses(covered);
    expect(upgrades.map((u) => u.slug).sort()).toEqual(Object.keys(IDENTITY_PAGE_BUNDLES).sort());
  });

  it("a partial confirm upgrades identity pages only in covered classes (bundle semantics)", () => {
    // Only V3 (plan-readiness): mission/who/how upgrade in plan-readiness;
    // how-we-decide's professional-practice echo and supply-chain stay put.
    const covered = classesCoveredByVectors(["growth-vs-stability"]);
    expect(covered).toEqual(["plan-readiness"]);
    const upgrades = identityUpgradesForClasses(covered);
    expect(upgrades).toEqual([
      { slug: "org-mission", domainClasses: ["plan-readiness"] },
      { slug: "org-who-we-serve", domainClasses: ["plan-readiness"] },
      { slug: "org-how-we-decide", domainClasses: ["plan-readiness"] },
    ]);
  });
});

describe("confirmedStanceBody", () => {
  it("includes the ceiling sentence only when a ceiling is set", () => {
    const withCeiling = confirmedStanceBody({
      title: "T",
      stance: "S".repeat(30),
      ceilingUsd: 150,
      orgLabel: "Acme",
    });
    expect(withCeiling.body).toContain("up to $150 per case");
    const without = confirmedStanceBody({
      title: "T",
      stance: "S".repeat(30),
      ceilingUsd: null,
      orgLabel: "Acme",
    });
    expect(without.body).not.toContain("Authority ceiling");
    expect(without.abstract).toBe("S".repeat(30));
  });
});
