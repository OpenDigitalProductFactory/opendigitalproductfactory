import { describe, it, expect } from "vitest";
import { parseAgentPortfolioSlug } from "./seed-helpers";

describe("parseAgentPortfolioSlug", () => {
  it("maps HR-100 to products_and_services_sold", () => {
    expect(parseAgentPortfolioSlug("HR-100")).toBe("products_and_services_sold");
  });

  it("maps HR-200 to for_employees", () => {
    expect(parseAgentPortfolioSlug("HR-200")).toBe("for_employees");
  });

  it("maps HR-300 to foundational", () => {
    expect(parseAgentPortfolioSlug("HR-300")).toBe("foundational");
  });

  it("maps HR-500 to manufacturing_and_delivery", () => {
    expect(parseAgentPortfolioSlug("HR-500")).toBe("manufacturing_and_delivery");
  });

  it("returns null for HR-000 (cross-cutting)", () => {
    expect(parseAgentPortfolioSlug("HR-000")).toBeNull();
  });

  it("returns null for HR-400 (cross-cutting)", () => {
    expect(parseAgentPortfolioSlug("HR-400")).toBeNull();
  });

  it("returns null for an unknown supervisor", () => {
    expect(parseAgentPortfolioSlug("HR-999")).toBeNull();
  });
});
