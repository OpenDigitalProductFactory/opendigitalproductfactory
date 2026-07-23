import { describe, it, expect } from "vitest";

import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_COST_DIMENSIONS,
} from "@dpf/db/wiki-taxonomy";
import {
  DIMENSION_CATALOG,
  DIMENSION_KEYS,
  buildFeaturesDescription,
  validateOptionFeatures,
  featureErrorRemedy,
} from "./dimension-catalog";

describe("dimension catalogue coverage", () => {
  // The ratchet. A dimension added to PRINCIPLE_DIMENSIONS without guidance
  // would reappear in the tool schema as a bare key with no explanation of what
  // a high score asserts — reintroducing exactly the defect BI-E0151DB2 closes.
  it("covers every dimension in the registry, and invents none", () => {
    expect([...DIMENSION_KEYS].sort()).toEqual([...PRINCIPLE_DIMENSIONS].sort());
    expect(DIMENSION_CATALOG).toHaveLength(PRINCIPLE_DIMENSIONS.length);
  });

  it("gives every dimension non-empty guidance", () => {
    for (const d of DIMENSION_CATALOG) {
      expect(d.highMeans.trim().length, `${d.key} needs guidance`).toBeGreaterThan(0);
    }
  });

  it("classifies exactly the registry's cost dimensions as costs", () => {
    const costs = DIMENSION_CATALOG.filter((d) => d.kind === "cost").map((d) => d.key);
    expect(costs.sort()).toEqual([...PRINCIPLE_COST_DIMENSIONS].sort());
  });

  // Cost guidance must describe MAGNITUDE ("reaches more of the estate"), never
  // goodness ("is safe") — scoring a cost axis by goodness inverts the meaning,
  // because the opposing principle carries a negative weight.
  it("phrases every cost axis as more-of-the-thing", () => {
    for (const d of DIMENSION_CATALOG.filter((c) => c.kind === "cost")) {
      expect(d.highMeans, `${d.key} must read as magnitude`).toMatch(/\bMORE\b/);
    }
  });
});

describe("features schema description", () => {
  const text = buildFeaturesDescription();

  it("states that features are required in practice, not merely optional", () => {
    expect(text).toMatch(/REQUIRED IN PRACTICE/);
    expect(text).toMatch(/insufficientSignal=true/);
  });

  it("warns that an omission is not a neutral or tie result", () => {
    expect(text).toMatch(/not a neutral or tie result|NOT a neutral/i);
  });

  it("enumerates every dimension key inline, so no file read is needed", () => {
    for (const key of PRINCIPLE_DIMENSIONS) {
      expect(text, `${key} must appear in the schema text`).toContain(key);
    }
  });

  it("says plainly that higher is worse on cost axes", () => {
    expect(text).toMatch(/HIGHER IS WORSE/);
    expect(text).toMatch(/negative weight/);
  });
});

describe("validateOptionFeatures", () => {
  it("accepts a well-formed feature map", () => {
    expect(
      validateOptionFeatures("opt-a", { blast_radius: 0.2, reusability: 1, speed_to_value: 0 }),
    ).toEqual([]);
  });

  // The unreported fourth defect: computeStructuredAlignment iterates the
  // PRINCIPLE's dimensions and reads option.features[dim], so a key that is not
  // a real dimension is never read and silently scores zero.
  it("REJECTS an unknown dimension key instead of ignoring it", () => {
    const errors = validateOptionFeatures("opt-a", { maintainability: 0.8 });
    expect(errors).toHaveLength(1);
    expect(errors[0].problem).toBe("unknown-dimension");
    expect(errors[0].optionId).toBe("opt-a");
  });

  it("suggests the nearest real dimension for a near-miss key", () => {
    const [err] = validateOptionFeatures("opt-a", { blast_radius_score: 0.5 });
    expect(err.problem).toBe("unknown-dimension");
    expect(err.detail).toContain("blast_radius");
  });

  it("rejects a value outside 0..1", () => {
    const errors = validateOptionFeatures("opt-a", { reusability: 1.5 });
    expect(errors[0].problem).toBe("out-of-range");
  });

  it("rejects a negative value", () => {
    expect(validateOptionFeatures("o", { reusability: -0.1 })[0].problem).toBe("out-of-range");
  });

  it("rejects a non-numeric value", () => {
    expect(validateOptionFeatures("o", { reusability: "high" })[0].problem).toBe("not-a-number");
  });

  it("rejects NaN", () => {
    expect(validateOptionFeatures("o", { reusability: Number.NaN })[0].problem).toBe("not-a-number");
  });

  it("reports every problem in one pass rather than stopping at the first", () => {
    const errors = validateOptionFeatures("o", {
      nonsense_axis: 0.5,
      reusability: 9,
      blast_radius: 0.3,
    });
    expect(errors).toHaveLength(2);
  });

  it("accepts an empty map (the caller is warned via signalQuality, not rejected)", () => {
    expect(validateOptionFeatures("o", {})).toEqual([]);
  });
});

describe("featureErrorRemedy", () => {
  it("lists the valid dimensions and names the cost axes", () => {
    const remedy = featureErrorRemedy();
    for (const key of PRINCIPLE_DIMENSIONS) expect(remedy).toContain(key);
    expect(remedy).toMatch(/higher = worse/);
  });
});
