import { describe, expect, it } from "vitest";
import { toOpenFormula } from "./to-openformula";

// Columns A..D: Item, Price, Qty, Status
const columns = new Map([
  ["item", 0],
  ["price", 1],
  ["qty", 2],
  ["status", 3],
]);

const at = (formula: string, row = 2) => toOpenFormula(formula, { columns, row });

describe("toOpenFormula", () => {
  it("turns column references into same-row cell references", () => {
    expect(at("[Price] * [Qty]")).toBe("of:=[.B2]*[.C2]");
    expect(at("=price*qty", 7)).toBe("of:=[.B7]*[.C7]");
  });

  it("keeps precedence with parentheses and maps the operators", () => {
    expect(at("([Price] + 1) * [Qty]")).toBe("of:=([.B2]+1)*[.C2]");
    expect(at("[Price] - ([Qty] - 1)")).toBe("of:=[.B2]-([.C2]-1)");
    expect(at("[Price] % 3")).toBe("of:=MOD([.B2];3)");
    expect(at('[Item] & " x"')).toBe('of:=[.A2]&" x"');
    expect(at("[Status] <> \"done\"")).toBe('of:=[.D2]<>"done"');
    expect(at('[Status] = "done"')).toBe('of:=[.D2]="done"');
    expect(at("-[Price]")).toBe("of:=-[.B2]");
  });

  it("maps functions, booleans and quoted strings", () => {
    expect(at('IF([Qty] > 10, "bulk", "single")')).toBe('of:=IF([.C2]>10;"bulk";"single")');
    expect(at("ROUND([Price] * 1.2, 2)")).toBe("of:=ROUND([.B2]*1.2;2)");
    expect(at("concat([Item], [Status])")).toBe("of:=CONCATENATE([.A2];[.D2])");
    expect(at("AND([Qty] > 1, true)")).toBe("of:=AND([.C2]>1;TRUE())");
    expect(at('"say \\"hi\\""')).toBe('of:="say ""hi"""');
  });

  it("returns null for anything it cannot express faithfully", () => {
    expect(at("COUNTIF([Status], \"done\")")).toBeNull();
    expect(at("REF([Item])")).toBeNull();
    expect(at("[Unknown] + 1")).toBeNull();
    expect(at("TODAY()")).toBeNull();
    expect(at("[Price] +")).toBeNull();
    expect(at("")).toBeNull();
  });
});
