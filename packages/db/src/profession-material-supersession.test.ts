import { describe, expect, it } from "vitest";

import {
  professionDomainClasses,
  supersedeDerivedMaterial,
} from "./profession-material-promotion";

/**
 * The defect these tests pin (BI-0EB9F1D2).
 *
 * Craft material was held to `professional-practice` at the derived tier, so a
 * profession whose only material is platform-distilled matched nothing in the
 * class its own callers ask about. The gate then fell through to platform
 * doctrine and answered a craft question as WWMD.
 *
 * Measured on this install over a fortnight: 654 of 654 enterprise-architecture
 * consults resolved that way, and zero decisions in the entire ledger were made
 * by a craft profile. The founder's ask — that specialists decide — was
 * structurally unreachable, not merely unused.
 */

function material(over: Partial<{ domainClass: string; evidenceGrade: string; confidenceWeight: number; id: string }> = {}) {
  return {
    id: over.id ?? "m",
    domainClass: over.domainClass ?? "architecture-tradeoff",
    evidenceGrade: over.evidenceGrade ?? "B",
    confidenceWeight: over.confidenceWeight ?? 0.6,
  };
}

const DERIVED = { evidenceGrade: "B", confidenceWeight: 0.6 };
const CONFIRMED = { evidenceGrade: "A", confidenceWeight: 0.9 };
const RULED = { evidenceGrade: "A", confidenceWeight: 1.0 };

describe("a craft answers every class its family is asked about", () => {
  it("gives enterprise-architecture its tradeoff class at the derived tier too", () => {
    // The class the EA advisory actually asks for, at the tier the seed produces.
    expect(professionDomainClasses("enterprise-architecture", "derived")).toEqual([
      "architecture-tradeoff",
      "professional-practice",
    ]);
  });

  it("is tier-independent, so confirming material changes weight, never reachability", () => {
    for (const tier of ["derived", "confirmed", "ruled"] as const) {
      expect(professionDomainClasses("enterprise-architecture", tier)).toEqual([
        "architecture-tradeoff",
        "professional-practice",
      ]);
    }
  });

  it("leaves a family with no mapping on professional-practice", () => {
    expect(professionDomainClasses("marketing", "derived")).toEqual(["professional-practice"]);
  });
});

describe("confirmed material supersedes derived within its own class", () => {
  it("drops the distillation so a human confirmation scores at its own weight", () => {
    // Without supersession the gate averages 0.45 and 0.9 to 0.675, below the
    // 0.7 recommend band: the platform's distillation would veto the human.
    const kept = supersedeDerivedMaterial([
      material({ id: "derived", ...DERIVED }),
      material({ id: "confirmed", ...CONFIRMED }),
    ]);
    expect(kept.map((m) => m.id)).toEqual(["confirmed"]);
  });

  it("supersedes per class, never across classes", () => {
    const kept = supersedeDerivedMaterial([
      material({ id: "tradeoff-derived", domainClass: "architecture-tradeoff", ...DERIVED }),
      material({ id: "tradeoff-confirmed", domainClass: "architecture-tradeoff", ...CONFIRMED }),
      material({ id: "practice-derived", domainClass: "professional-practice", ...DERIVED }),
    ]);
    // The practice class has no vouched material, so its distillation stays.
    expect(kept.map((m) => m.id).sort()).toEqual(["practice-derived", "tradeoff-confirmed"]);
  });

  it("keeps an all-derived class intact, so the craft still answers from its own profile", () => {
    const all = [
      material({ id: "a", ...DERIVED }),
      material({ id: "b", domainClass: "professional-practice", ...DERIVED }),
    ];
    expect(supersedeDerivedMaterial(all)).toEqual(all);
  });

  it("treats a ruled page as vouched too", () => {
    const kept = supersedeDerivedMaterial([
      material({ id: "derived", ...DERIVED }),
      material({ id: "ruled", ...RULED }),
    ]);
    expect(kept.map((m) => m.id)).toEqual(["ruled"]);
  });

  it("is a no-op on an empty corpus", () => {
    expect(supersedeDerivedMaterial([])).toEqual([]);
  });
});
