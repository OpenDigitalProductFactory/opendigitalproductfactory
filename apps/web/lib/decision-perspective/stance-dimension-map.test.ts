import { describe, expect, it } from "vitest";

import { PRINCIPLE_COST_DIMENSIONS, PRINCIPLE_DIMENSIONS } from "@dpf/db/wiki-taxonomy";

import { STANCE_VECTOR_KEYS } from "@/lib/onboarding/archetype-business-context";
import {
  findStanceDimensionMapViolations,
  isStanceForbiddenDimension,
  STANCE_DIMENSION_MAP,
  STANCE_FORBIDDEN_DIMENSIONS,
  STANCE_MAX_MAGNITUDE,
  projectStanceDimensionVector,
  type StanceAxisEdge,
} from "./stance-dimension-map";

// BI-E1427A3E Phase 0. These are the guard the spec (§4.3) requires: the map is
// the reviewable artifact, so its invariants must fail loudly in CI rather than
// be discovered when a derived vector starts scoring real decisions.

describe("stance-dimension-map: the live map is well-formed", () => {
  it("projects every stance into a persisted non-null vector", () => {
    for (const key of STANCE_VECTOR_KEYS) {
      const projected = projectStanceDimensionVector(key);
      expect(projected.principleDimensions.length).toBeGreaterThan(0);
      expect(Object.keys(projected.principleDimensionVector)).toEqual(
        expect.arrayContaining(projected.principleDimensions),
      );
    }
  });

  it("projects the four constitutional alignment axes from declared stance purpose", () => {
    const projected = projectStanceDimensionVector("growth-vs-stability");
    expect(projected.principleDimensions).toEqual(
      expect.arrayContaining(["mission_fit", "market_fit", "product_fit", "gtm_fit"]),
    );
  });
  it("passes every invariant (signs, caps, forbidden axes, rationales)", () => {
    expect(findStanceDimensionMapViolations()).toEqual([]);
  });

  it("maps every stance key — an unmapped stance is a silent no-op", () => {
    for (const key of STANCE_VECTOR_KEYS) {
      expect(STANCE_DIMENSION_MAP[key].length).toBeGreaterThan(0);
    }
  });

  it("only ever targets axes in the closed registry", () => {
    const registry = new Set<string>(PRINCIPLE_DIMENSIONS);
    for (const key of STANCE_VECTOR_KEYS) {
      for (const edge of STANCE_DIMENSION_MAP[key] as readonly StanceAxisEdge[]) {
        expect(registry.has(edge.dimension)).toBe(true);
      }
    }
  });
});

describe("stance-dimension-map: kernel ruling DI-A01830820221 (never derive safety)", () => {
  it("declares public_safety forbidden", () => {
    expect(STANCE_FORBIDDEN_DIMENSIONS).toContain("public_safety");
    expect(isStanceForbiddenDimension("public_safety")).toBe(true);
    expect(isStanceForbiddenDimension("cost_efficiency")).toBe(false);
  });

  it("no stance derives public_safety — including quality-bar, the tempting case", () => {
    for (const key of STANCE_VECTOR_KEYS) {
      const dimensions = (STANCE_DIMENSION_MAP[key] as readonly StanceAxisEdge[]).map(
        (edge) => edge.dimension,
      );
      expect(dimensions).not.toContain("public_safety");
    }
  });
});

describe("stance-dimension-map: kernel ruling DI-687A1094E253 (cap below doctrine)", () => {
  it("caps strictly below the commandment magnitude of 1.0", () => {
    expect(STANCE_MAX_MAGNITUDE).toBeLessThan(1);
  });

  it("keeps every edge within the cap", () => {
    for (const key of STANCE_VECTOR_KEYS) {
      for (const edge of STANCE_DIMENSION_MAP[key] as readonly StanceAxisEdge[]) {
        expect(Math.abs(edge.weight)).toBeLessThanOrEqual(STANCE_MAX_MAGNITUDE);
      }
    }
  });
});

describe("stance-dimension-map: sign convention (the never-wipe-db inversion class)", () => {
  it("never assigns a positive weight to a cost axis", () => {
    const costs = new Set<string>(PRINCIPLE_COST_DIMENSIONS);
    const offenders: string[] = [];
    for (const key of STANCE_VECTOR_KEYS) {
      for (const edge of STANCE_DIMENSION_MAP[key] as readonly StanceAxisEdge[]) {
        if (costs.has(edge.dimension) && edge.weight > 0) {
          offenders.push(`${key} -> ${edge.dimension} = ${edge.weight}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("scores the cost axes it does use in the negative direction", () => {
    // Guards against the map quietly dropping its cost edges to dodge the sign
    // rule — the inversion's lazier cousin.
    const used = new Set<string>();
    for (const key of STANCE_VECTOR_KEYS) {
      for (const edge of STANCE_DIMENSION_MAP[key] as readonly StanceAxisEdge[]) {
        if (PRINCIPLE_COST_DIMENSIONS.includes(edge.dimension as never)) {
          used.add(edge.dimension);
          expect(edge.weight).toBeLessThan(0);
        }
      }
    }
    expect(used.size).toBeGreaterThan(0);
  });
});

describe("stance-dimension-map: profession-local edges are declared", () => {
  it("flags capacity_utilization as profession-local so derivation cannot leak it", () => {
    const edge = (STANCE_DIMENSION_MAP["growth-vs-stability"] as readonly StanceAxisEdge[]).find(
      (candidate) => candidate.dimension === "capacity_utilization",
    );
    expect(edge?.professionLocal).toBe(true);
  });
});

describe("stance-dimension-map: the guard can actually fail", () => {
  // A checker only ever run against a known-good map proves nothing. These feed
  // the REAL function deliberately-broken maps and assert it catches each one.
  const OK = "a sufficiently long rationale string to pass review";
  const mapWith = (edges: StanceAxisEdge[]) => ({ "quality-bar": edges });
  const violationsFor = (edges: StanceAxisEdge[]) =>
    findStanceDimensionMapViolations(mapWith(edges)).filter((v) => v.startsWith("quality-bar"));

  it("catches a positive weight on a cost axis", () => {
    const found = violationsFor([{ dimension: "blast_radius", weight: 0.3, rationale: OK }]);
    expect(found.some((v) => v.includes("POSITIVE"))).toBe(true);
  });

  it("catches an over-cap weight", () => {
    const found = violationsFor([{ dimension: "cost_efficiency", weight: 0.9, rationale: OK }]);
    expect(found.some((v) => v.includes("STANCE_MAX_MAGNITUDE"))).toBe(true);
  });

  it("catches a forbidden axis", () => {
    const found = violationsFor([{ dimension: "public_safety", weight: 0.2, rationale: OK }]);
    expect(found.some((v) => v.includes("forbidden"))).toBe(true);
  });

  it("catches a missing rationale", () => {
    const found = violationsFor([{ dimension: "cost_efficiency", weight: 0.2, rationale: "short" }]);
    expect(found.some((v) => v.includes("rationale"))).toBe(true);
  });

  it("catches a zero weight and a duplicate edge", () => {
    const zero = violationsFor([{ dimension: "cost_efficiency", weight: 0, rationale: OK }]);
    expect(zero.some((v) => v.includes("non-zero"))).toBe(true);

    const dupe = violationsFor([
      { dimension: "cost_efficiency", weight: 0.2, rationale: OK },
      { dimension: "cost_efficiency", weight: 0.3, rationale: OK },
    ]);
    expect(dupe.some((v) => v.includes("duplicate"))).toBe(true);
  });

  it("catches a stance mapped to nothing", () => {
    const found = findStanceDimensionMapViolations({}).filter((v) => v.includes("no edges"));
    expect(found.length).toBe(STANCE_VECTOR_KEYS.length);
  });

  it("passes a well-formed synthetic map, so it is not simply always failing", () => {
    expect(violationsFor([{ dimension: "cost_efficiency", weight: 0.2, rationale: OK }])).toEqual([]);
  });
});
