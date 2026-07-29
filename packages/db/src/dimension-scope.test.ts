import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_COST_DIMENSIONS,
  type PrincipleDimension,
} from "./wiki-taxonomy";
import {
  PRINCIPLE_DIMENSION_SCOPE,
  PRINCIPLE_SPINE_DIMENSIONS,
  PRINCIPLE_LOCAL_DIMENSIONS,
  PRINCIPLE_DIMENSION_SOURCING,
  PRINCIPLE_DIMENSION_SOURCINGS,
  dimensionSourcing,
  dimensionsBySourcing,
  assertDimensionScopeIntegrity,
  isSpineDimension,
  projectVectorOntoSpine,
} from "./dimension-scope";

// BI-AA7D80FE — spine reduction by demotion, not deletion.
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md §2.1.
//
// The classification is a governance artifact: it decides which axes remain the
// shared commensurability layer. These tests pin the invariants that make a
// demotion safe, so a future axis cannot be quietly dropped from every
// cross-profession decision by labelling it local and forgetting the projection.

const REGISTRY_PROFESSIONS: ReadonlySet<string> = new Set(
  (
    JSON.parse(
      readFileSync(
        join(__dirname, "../../../docs/professions/registry.json"),
        "utf8",
      ),
    ) as { families: Array<{ professionKey: string }> }
  ).families.map((f) => f.professionKey),
);

describe("dimension scope — every axis is classified", () => {
  it("labels every dimension exactly once, spine or profession-local", () => {
    for (const d of PRINCIPLE_DIMENSIONS) {
      expect(PRINCIPLE_DIMENSION_SCOPE[d], `${d} is unclassified`).toBeDefined();
    }
    expect(
      PRINCIPLE_SPINE_DIMENSIONS.length + PRINCIPLE_LOCAL_DIMENSIONS.length,
    ).toBe(PRINCIPLE_DIMENSIONS.length);
    // No axis is both.
    for (const d of PRINCIPLE_SPINE_DIMENSIONS) {
      expect(PRINCIPLE_LOCAL_DIMENSIONS).not.toContain(d);
    }
  });

  it("reduction was by DEMOTION, not deletion — the registry still carries every axis", () => {
    // The whole point of §2.1: a demoted axis keeps scoring inside its
    // profession. If a future change 'simplifies' by removing an axis outright,
    // this fails.
    expect(PRINCIPLE_DIMENSIONS.length).toBeGreaterThanOrEqual(20);
    for (const d of PRINCIPLE_LOCAL_DIMENSIONS) {
      expect(PRINCIPLE_DIMENSIONS).toContain(d);
    }
  });

  it("every axis carries a written rationale — the demotion argument is recorded", () => {
    for (const d of PRINCIPLE_DIMENSIONS) {
      const entry = PRINCIPLE_DIMENSION_SCOPE[d];
      expect(entry.rationale.length, `${d} has a stub rationale`).toBeGreaterThan(40);
    }
  });

  it("passes structural integrity against the real profession registry", () => {
    expect(() => assertDimensionScopeIntegrity(REGISTRY_PROFESSIONS)).not.toThrow();
  });
});

describe("dimension scope — projections keep the space commensurable", () => {
  it("every profession-local axis projects onto at least one spine axis", () => {
    for (const d of PRINCIPLE_LOCAL_DIMENSIONS) {
      const entry = PRINCIPLE_DIMENSION_SCOPE[d];
      if (entry.scope !== "profession-local") throw new Error("unreachable");
      expect(entry.projectsOnto.length, `${d} has no projection`).toBeGreaterThan(0);
    }
  });

  it("projections terminate on the spine in one hop", () => {
    for (const d of PRINCIPLE_LOCAL_DIMENSIONS) {
      const entry = PRINCIPLE_DIMENSION_SCOPE[d];
      if (entry.scope !== "profession-local") throw new Error("unreachable");
      for (const target of entry.projectsOnto) {
        expect(isSpineDimension(target), `${d} -> ${target} is not spine`).toBe(true);
      }
    }
  });

  it("every profession-local axis is owned by a real professionKey", () => {
    for (const d of PRINCIPLE_LOCAL_DIMENSIONS) {
      const entry = PRINCIPLE_DIMENSION_SCOPE[d];
      if (entry.scope !== "profession-local") throw new Error("unreachable");
      expect(
        REGISTRY_PROFESSIONS.has(entry.profession),
        `${d} claims profession "${entry.profession}"`,
      ).toBe(true);
    }
  });
});

describe("projectVectorOntoSpine", () => {
  it("passes spine axes through untouched", () => {
    const out = projectVectorOntoSpine({ long_term_maintainability: 0.9, blast_radius: -0.3 });
    expect(out).toEqual({ long_term_maintainability: 0.9, blast_radius: -0.3 });
  });

  it("rolls a local axis onto its declared spine target", () => {
    // reusability -> long_term_maintainability
    expect(projectVectorOntoSpine({ reusability: 0.8 })).toEqual({
      long_term_maintainability: 0.8,
    });
  });

  it("splits a multi-target projection so demotion cannot amplify a principle", () => {
    // operational_independence -> [long_term_maintainability, blast_radius].
    // Projecting 0.6 at FULL magnitude onto both would turn one authored axis
    // into 1.2 of total pull — a demoted principle would outweigh its
    // un-demoted self, which would make demotion a stealth promotion.
    const out = projectVectorOntoSpine({ operational_independence: 0.6 });
    expect(out.long_term_maintainability).toBeCloseTo(0.3);
    expect(out.blast_radius).toBeCloseTo(0.3);
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(0.6);
  });

  it("sums when a local axis and its spine target are both scored", () => {
    const out = projectVectorOntoSpine({
      long_term_maintainability: 0.5,
      reusability: 0.4,
    });
    expect(out.long_term_maintainability).toBeCloseTo(0.9);
  });

  it("preserves sign, so a cost axis stays a cost after projection", () => {
    // business_disruption is a COST that projects onto blast_radius, also a
    // cost. A principle pulling against disruption carries a negative weight;
    // if projection dropped the sign it would start REWARDING disruption —
    // the same inversion class the sign-convention guard exists to prevent.
    expect(PRINCIPLE_COST_DIMENSIONS).toContain("business_disruption");
    const out = projectVectorOntoSpine({ business_disruption: -0.7 });
    expect(out.blast_radius).toBeCloseTo(-0.7);
  });

  it("ignores keys that are not dimensions rather than inventing an axis", () => {
    expect(projectVectorOntoSpine({ not_a_dimension: 0.9 })).toEqual({});
  });
});

describe("dimension scope — the judgement calls are pinned deliberately", () => {
  // These assert specific classifications. They are meant to be edited by a
  // human making a governance decision, not silently drifted into.

  it("keeps universal obligations on the spine despite near-zero usage", () => {
    // public_safety (3 uses) and data_privacy (1 use). If a safety objection
    // could not be weighed against a design objection in one ledger, the spine
    // would have failed at its only job.
    expect(isSpineDimension("public_safety")).toBe(true);
    expect(isSpineDimension("data_privacy")).toBe(true);
  });

  it("protects axes that are young rather than niche", () => {
    // Landed 2026-07-23 (BI-B5EA2FB2). Low counts measure age, not reach.
    expect(isSpineDimension("operator_effort")).toBe(true);
    expect(isSpineDimension("legibility_of_consequence")).toBe(true);
  });

  it("keeps cost_efficiency on the spine as the explicit unused-axis exception", () => {
    // Scored by ZERO principles. §2.1 names it the exception: an unused axis
    // means the corpus has a gap, not that money is niche.
    expect(isSpineDimension("cost_efficiency")).toBe(true);
  });

  it("demotes the software-vocabulary axes even when heavily used", () => {
    // schema_grounding is the 3rd-most-used axis (39) but 51% specialist-
    // authored; reusability is 64% specialist. Their usage reflects the
    // software cohort's over-representation in the kernel, which is the
    // finding this whole epic exists to correct.
    expect(isSpineDimension("schema_grounding")).toBe(false);
    expect(isSpineDimension("reusability")).toBe(false);
    for (const d of ["schema_grounding", "reusability"] as PrincipleDimension[]) {
      const entry = PRINCIPLE_DIMENSION_SCOPE[d];
      if (entry.scope !== "profession-local") throw new Error("unreachable");
      expect(entry.profession).toBe("software-engineer");
    }
  });

  it("leaves a spine that is smaller than the full registry but not degenerate", () => {
    expect(PRINCIPLE_SPINE_DIMENSIONS.length).toBeLessThan(PRINCIPLE_DIMENSIONS.length);
    expect(PRINCIPLE_SPINE_DIMENSIONS.length).toBeGreaterThanOrEqual(8);
  });
});

// BI-25CCF1A4 Phase 0 — dimension sourcing. Sourcing (how a weight is kept
// honest) is orthogonal to scope (which population owns the vocabulary). These
// pin the honest baseline and the schema-honesty invariant: no axis is labelled
// with a source it does not yet actually draw its weight from.
describe("dimension sourcing — every axis is sourcing-classified", () => {
  it("labels every dimension with a known sourcing class", () => {
    for (const d of PRINCIPLE_DIMENSIONS) {
      expect(PRINCIPLE_DIMENSION_SOURCING[d], `${d} has no sourcing class`).toBeDefined();
      expect(PRINCIPLE_DIMENSION_SOURCINGS).toContain(dimensionSourcing(d));
    }
  });

  it("ships the HONEST baseline: every axis is `basic` (uniformly hand-authored) — that uniformity is the gap the inventory repairs", () => {
    // Schema-honesty: an axis is reclassified ONLY when its weight actually
    // comes from that source. Until the per-job inventory wires corpus
    // derivation / revealed inference / external lookup, everything is basic.
    for (const d of PRINCIPLE_DIMENSIONS) {
      expect(dimensionSourcing(d), `${d} claims a source it is not yet wired to`).toBe("basic");
    }
    expect(dimensionsBySourcing("basic")).toHaveLength(PRINCIPLE_DIMENSIONS.length);
    for (const s of ["corpus-derived", "revealed", "external"] as const) {
      expect(dimensionsBySourcing(s), `${s} must stay empty until an axis is wired to it`).toHaveLength(0);
    }
  });

  it("dimensionsBySourcing partitions the registry (every axis in exactly one class)", () => {
    const counted = PRINCIPLE_DIMENSION_SOURCINGS.reduce(
      (sum, s) => sum + dimensionsBySourcing(s).length,
      0,
    );
    expect(counted).toBe(PRINCIPLE_DIMENSIONS.length);
  });
});
