import { describe, it, expect } from "vitest";
import { checkFormula } from "./check";

const COLUMNS = ["Title", "Estimate (h)", "Spent", "Status"];

describe("checkFormula — static validation before a formula column is saved", () => {
  it("accepts arithmetic over existing columns, by name or [bracket] form", () => {
    expect(checkFormula("[Estimate (h)] - Spent", COLUMNS)).toBeNull();
    expect(checkFormula("=IF(Spent > 0, ROUND(Spent / 2, 1), 0)", COLUMNS)).toBeNull();
  });

  it("accepts constants and cross-row / reference functions", () => {
    expect(checkFormula("IF(true, 1, 0)", COLUMNS)).toBeNull();
    expect(checkFormula('COUNTIF([Status], "done")', COLUMNS)).toBeNull();
  });

  it("refuses an unknown column name", () => {
    expect(checkFormula("[Budget] * 2", COLUMNS)).toMatch(/unknown column: Budget/i);
  });

  it("refuses an unknown function", () => {
    expect(checkFormula("EVAL(Spent)", COLUMNS)).toMatch(/unknown function: EVAL/i);
  });

  it("refuses a syntax error", () => {
    expect(checkFormula("Spent +", COLUMNS)).toMatch(/formula/i);
  });

  it("refuses property access and multiple expressions", () => {
    expect(checkFormula("Spent.constructor", COLUMNS)).toMatch(/not supported/i);
    expect(checkFormula("Spent, Title", COLUMNS)).not.toBeNull();
  });

  it("refuses an empty formula", () => {
    expect(checkFormula("  = ", COLUMNS)).toMatch(/required/i);
  });
});
