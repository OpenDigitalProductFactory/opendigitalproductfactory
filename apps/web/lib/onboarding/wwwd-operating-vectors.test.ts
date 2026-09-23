import { describe, expect, it } from "vitest";
import {
  GENERIC_STANCE_VECTORS,
  STANCE_VECTOR_KEYS,
  resolveStanceVectors,
} from "./archetype-business-context";
import { STANCE_VECTOR_BUNDLES } from "./seed-org-wwwd-corpus";
import {
  STANCE_MAX_MAGNITUDE,
  STANCE_FORBIDDEN_DIMENSIONS,
  projectStanceDimensionVector,
} from "@/lib/decision-perspective/stance-dimension-map";

/**
 * BI-7728C3B7. Onboarding seeded money and quality but was silent on the
 * classes that actually reached the owner unanswered on the customer 0
 * install: personal-data handling (6 of 19 open reviews), routine operations
 * nobody wanted to be asked about, and questions that were not the business's
 * to decide. A business cannot begin operating on a corpus silent on those.
 */
const OPERATING_VECTORS = ["data-handling", "routine-operations", "decision-scope"] as const;

describe("WWWD operating vectors seeded at onboarding", () => {
  it("ships a default for every operating vector, so a new install is not silent", () => {
    for (const key of OPERATING_VECTORS) {
      expect(STANCE_VECTOR_KEYS).toContain(key);
      const vector = GENERIC_STANCE_VECTORS[key];
      expect(vector.title.length).toBeGreaterThan(5);
      // Long enough to be a usable starting stance, not a placeholder.
      expect(vector.stance.length).toBeGreaterThan(120);
    }
  });

  it("lands each operating vector in the decision classes that consult it", () => {
    expect(STANCE_VECTOR_BUNDLES["data-handling"]).toContain("risk-assessment");
    expect(STANCE_VECTOR_BUNDLES["routine-operations"]).toContain("plan-readiness");
    expect(STANCE_VECTOR_BUNDLES["decision-scope"]).toContain("plan-readiness");
    for (const key of OPERATING_VECTORS) {
      expect(STANCE_VECTOR_BUNDLES[key].length).toBeGreaterThan(0);
    }
  });

  it("differentiates the software-platform archetype from the generic default", () => {
    const platform = resolveStanceVectors({ industry: "software-platform" });
    for (const key of OPERATING_VECTORS) {
      expect(platform[key].stance).not.toBe(GENERIC_STANCE_VECTORS[key].stance);
    }
    // The archetype's own vocabulary, not a commercial-retail paraphrase.
    expect(platform["data-handling"].stance).toMatch(/lawful basis|jurisdiction|minimum/i);
    expect(platform["decision-scope"].stance).toMatch(/customers' own|research/i);
  });

  it("keeps a non-commercial archetype free of commercial vocabulary", () => {
    const nonprofit = resolveStanceVectors({ industry: "nonprofit-community" });
    const rendered = OPERATING_VECTORS.map((k) => `${nonprofit[k].title} ${nonprofit[k].stance}`).join(" ");
    expect(rendered).not.toMatch(/\bcustomer\b|\bprices\b|\bsell\b/i);
  });

  it("projects each operating vector onto the closed axis registry within the stance ceiling", () => {
    for (const key of OPERATING_VECTORS) {
      const { principleDimensionVector, principleDimensions } = projectStanceDimensionVector(key);
      expect(principleDimensions.length).toBeGreaterThan(0);
      for (const [dimension, weight] of Object.entries(principleDimensionVector)) {
        // A commercial stance may never manufacture a safety weight.
        expect(STANCE_FORBIDDEN_DIMENSIONS as readonly string[]).not.toContain(dimension);
        expect(Math.abs(weight)).toBeLessThanOrEqual(STANCE_MAX_MAGNITUDE);
      }
    }
  });

  it("scores data-handling on the privacy axis rather than a proxy for it", () => {
    const { principleDimensionVector } = projectStanceDimensionVector("data-handling");
    expect(principleDimensionVector["data_privacy"]).toBeGreaterThan(0);
    // Narrowing exposure is a cost axis the stance pulls AGAINST.
    expect(principleDimensionVector["blast_radius"]).toBeLessThan(0);
  });

  it("scores routine-operations as removing owner load, not adding it", () => {
    const { principleDimensionVector } = projectStanceDimensionVector("routine-operations");
    expect(principleDimensionVector["human_cognitive_load"]).toBeLessThan(0);
    expect(principleDimensionVector["operator_effort"]).toBeLessThan(0);
    expect(principleDimensionVector["speed_to_value"]).toBeGreaterThan(0);
  });
});

describe("nonprofit presentation parity", () => {
  it("overrides every stance vector, so none falls back to commercial wording", async () => {
    const { NONPROFIT_STANCE_VECTORS } = await import("./archetype-stance-presentation");
    // A vector added upstream without a nonprofit wording would silently serve
    // "customer"/"prices" to an organisation that has neither.
    expect(Object.keys(NONPROFIT_STANCE_VECTORS).sort()).toEqual([...STANCE_VECTOR_KEYS].sort());
  });
});
