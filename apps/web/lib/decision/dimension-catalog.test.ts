import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  // BI-2B196D07 (finding F4). AGENTS.md is the always-on instruction plane: whatever it
  // says about sign convention is what every external agent acts on. It claimed "the four
  // cost axes" and listed four while the registry held five, so agents supplied
  // `operator_effort` as though higher were better — inverting the sign on the axis most
  // relevant to disclosure and cognitive-load decisions. Prose drifting from a code
  // registry on a load-bearing rule is the exact failure BI-0020D511 exists to stop, so
  // the count and the names are now asserted rather than trusted.
  it("AGENTS.md names every cost axis, with a count that matches the registry", () => {
    const agentsMd = readFileSync(
      fileURLToPath(new URL("../../../../AGENTS.md", import.meta.url)),
      "utf8",
    );
    const sentence = /\b(\w+)\s+\*\*cost\*\*\s+axes\s+\(([^)]*)\)/.exec(agentsMd);
    expect(sentence, "AGENTS.md no longer describes the cost axes — update this guard").not.toBeNull();

    const [, writtenCount, listed] = sentence!;
    const named = [...listed.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
    expect(named.sort()).toEqual([...PRINCIPLE_COST_DIMENSIONS].sort());

    const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
    expect(writtenCount).toBe(numberWords[PRINCIPLE_COST_DIMENSIONS.length]);
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

  // BI-AA7D80FE. The spine/profession-local split is useless to a caller who
  // cannot see it — an in-platform coworker has no repo access, so a label that
  // lives only in the registry may as well not exist for the population that
  // does most of the scoring.
  it("carries the spine / profession-local scope for every dimension", () => {
    for (const d of DIMENSION_CATALOG) {
      expect(["spine", "profession-local"], `${d.key} scope`).toContain(d.scope);
    }
  });

  it("names the owning profession on profession-local axes, and only those", () => {
    for (const d of DIMENSION_CATALOG) {
      if (d.scope === "profession-local") {
        expect(d.profession, `${d.key} needs an owning profession`).toBeTruthy();
      } else {
        expect(d.profession, `${d.key} is spine and must not claim one`).toBeUndefined();
      }
    }
  });

  it("keeps both scopes populated — a split with an empty side is not a split", () => {
    expect(DIMENSION_CATALOG.filter((d) => d.scope === "spine").length).toBeGreaterThan(0);
    expect(
      DIMENSION_CATALOG.filter((d) => d.scope === "profession-local").length,
    ).toBeGreaterThan(0);
  });
});

describe("features schema description", () => {
  const text = buildFeaturesDescription();

  it("tells the caller which axes are profession-local and what they roll up to", () => {
    expect(text).toMatch(/AXIS SCOPE/);
    expect(text).toMatch(/PROFESSION-LOCAL/);
    // The two biggest demotions must be named explicitly with their owner.
    expect(text).toContain("schema_grounding (software-engineer)");
    expect(text).toContain("reusability (software-engineer)");
  });

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
