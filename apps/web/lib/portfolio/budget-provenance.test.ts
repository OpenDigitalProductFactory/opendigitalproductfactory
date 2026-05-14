import { describe, expect, it } from "vitest";
import { getPortfolioBudgetMetric } from "@/lib/portfolio/budget-provenance";

describe("getPortfolioBudgetMetric", () => {
  it("classifies known seeded portfolio budgets as demo placeholders", () => {
    const metric = getPortfolioBudgetMetric("manufacturing_and_delivery", 1800);

    expect(metric.value).toBe("$1.8M");
    expect(metric.provenance?.kind).toBe("demo-placeholder");
    expect(metric.provenance?.label).toBe("Planning placeholder");
    expect(metric.provenance?.description).toContain("seeded demonstration budget");
  });

  it("shows missing portfolio budgets as not connected", () => {
    const metric = getPortfolioBudgetMetric("foundational", null);

    expect(metric.value).toBe("\u2014");
    expect(metric.provenance?.kind).toBe("not-connected");
    expect(metric.provenance?.label).toBe("No connected budget source");
  });

  it("treats non-placeholder stored budgets as live database values", () => {
    const metric = getPortfolioBudgetMetric("foundational", 420);

    expect(metric.value).toBe("$420k");
    expect(metric.provenance?.kind).toBe("live-db");
    expect(metric.provenance?.label).toBe("Stored budget");
    expect(metric.provenance?.sourceTable).toBe("Portfolio");
  });
});
