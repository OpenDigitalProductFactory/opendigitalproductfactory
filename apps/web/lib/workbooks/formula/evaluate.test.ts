import { describe, it, expect } from "vitest";
import { evaluateFormula, normalizeName, normalizeFormulaSource, type FormulaValue } from "./evaluate";

function scope(obj: Record<string, FormulaValue>): Map<string, FormulaValue> {
  const m = new Map<string, FormulaValue>();
  for (const [k, v] of Object.entries(obj)) m.set(normalizeName(k), v);
  return m;
}

describe("normalizeFormulaSource", () => {
  it("strips a leading =, maps <> to != and single = to ==, and resolves [Name]", () => {
    // Bare identifiers keep their case (lookup is case-insensitive); only
    // bracketed [Names] are normalized to a comparison key.
    expect(normalizeFormulaSource("=A = B")).toBe("A == B");
    expect(normalizeFormulaSource("A <> B")).toBe("A != B");
    expect(normalizeFormulaSource("[Total Amount] >= 10")).toBe("totalamount >= 10");
    expect(normalizeFormulaSource("a <= b")).toBe("a <= b");
  });
});

describe("evaluateFormula — arithmetic & operators", () => {
  it("evaluates arithmetic over column refs", () => {
    expect(evaluateFormula("=price * qty", scope({ price: 4, qty: 3 }))).toEqual({ ok: true, value: 12 });
  });
  it("supports Excel string concat with &", () => {
    expect(evaluateFormula('=first & " " & last', scope({ first: "Ada", last: "Lovelace" }))).toEqual({
      ok: true,
      value: "Ada Lovelace",
    });
  });
  it("supports Excel equality (=) and inequality (<>)", () => {
    expect(evaluateFormula("=status = \"open\"", scope({ status: "open" }))).toEqual({ ok: true, value: true });
    expect(evaluateFormula("=status <> \"open\"", scope({ status: "done" }))).toEqual({ ok: true, value: true });
  });
});

describe("evaluateFormula — functions", () => {
  it("IF / IFS branch on conditions", () => {
    expect(evaluateFormula('=IF(p>3,"high","low")', scope({ p: 5 }))).toEqual({ ok: true, value: "high" });
    expect(evaluateFormula('=IFS(p>9,"a",p>3,"b")', scope({ p: 5 }))).toEqual({ ok: true, value: "b" });
  });
  it("text functions", () => {
    expect(evaluateFormula("=UPPER(LEFT(name,3))", scope({ name: "lovelace" }))).toEqual({ ok: true, value: "LOV" });
    expect(evaluateFormula("=LEN(TRIM(s))", scope({ s: "  hi  " }))).toEqual({ ok: true, value: 2 });
  });
  it("math functions", () => {
    expect(evaluateFormula("=ROUND(a/b,2)", scope({ a: 10, b: 3 }))).toEqual({ ok: true, value: 3.33 });
    expect(evaluateFormula("=MAX(a,b,c)", scope({ a: 1, b: 9, c: 4 }))).toEqual({ ok: true, value: 9 });
  });
  it("DATEDIF in days", () => {
    expect(
      evaluateFormula('=DATEDIF(start,end,"D")', scope({ start: "2026-01-01", end: "2026-01-11" })),
    ).toEqual({ ok: true, value: 10 });
  });
});

describe("evaluateFormula — error handling (never throws)", () => {
  it("reports division by zero", () => {
    const r = evaluateFormula("=a/b", scope({ a: 1, b: 0 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/zero/i);
  });
  it("reports an unknown field", () => {
    const r = evaluateFormula("=missing+1", scope({ a: 1 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown field/i);
  });
  it("reports an unknown function", () => {
    const r = evaluateFormula("=BOGUS(1)", scope({}));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown function/i);
  });
  it("rejects property access (no arbitrary code)", () => {
    const r = evaluateFormula("=a.b", scope({ a: 1 }));
    expect(r.ok).toBe(false);
  });
  it("treats an empty formula as null", () => {
    expect(evaluateFormula("=", scope({}))).toEqual({ ok: true, value: null });
  });
});
