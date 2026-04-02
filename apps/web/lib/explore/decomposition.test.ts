import { describe, expect, it } from "vitest";
import { validateDecompositionPlan, createTechDebtItem } from "./decomposition";
import type { DecompositionPlan } from "./feature-build-types";

describe("validateDecompositionPlan", () => {
  it("accepts a valid plan", () => {
    const plan: DecompositionPlan = {
      epicTitle: "Financial Management",
      epicDescription: "End-to-end financial management",
      featureSets: [{
        title: "Internal Ledger", description: "Double-entry bookkeeping",
        type: "digital_product", estimatedBuilds: 3,
        recommendation: "build", rationale: "Core capability", techDebtNote: null,
      }],
    };
    expect(validateDecompositionPlan(plan).valid).toBe(true);
  });
  it("rejects empty epicTitle", () => {
    const plan: DecompositionPlan = { epicTitle: "", epicDescription: "desc", featureSets: [{ title: "X", description: "Y", type: "feature_build", estimatedBuilds: 1, recommendation: "build", rationale: "R", techDebtNote: null }] };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });
  it("rejects no feature sets", () => {
    const plan: DecompositionPlan = { epicTitle: "Epic", epicDescription: "desc", featureSets: [] };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });
  it("rejects feature set with empty title", () => {
    const plan: DecompositionPlan = { epicTitle: "Epic", epicDescription: "desc", featureSets: [{ title: "", description: "Y", type: "feature_build", estimatedBuilds: 1, recommendation: "build", rationale: "R", techDebtNote: null }] };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });
});

describe("createTechDebtItem", () => {
  it("returns a backlog item shape", () => {
    const item = createTechDebtItem({ title: "Replace Invoice Ninja", description: "External dependency", severity: "medium" });
    expect(item.title).toBe("Replace Invoice Ninja");
    expect(item.type).toBe("product");
    expect(item.status).toBe("open");
    expect(item.itemId).toMatch(/^BI-REFACTOR-/);
  });
});
