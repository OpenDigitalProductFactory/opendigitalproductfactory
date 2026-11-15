import { describe, expect, it } from "vitest";
import { parseWithholdingTableText } from "./withholding-table-text";

describe("parseWithholdingTableText", () => {
  it("reads rows as printed, with commas, dollar signs and percent signs", () => {
    expect(parseWithholdingTableText("$0  0%\n7,500 10%\n\n$19,900  12")).toEqual({
      readable: true,
      rows: [{ over: 0, rate: 0 }, { over: 7_500, rate: 0.1 }, { over: 19_900, rate: 0.12 }],
    });
  });

  it("names the line it cannot read", () => {
    expect(parseWithholdingTableText("0 0%\n7,500\n")).toEqual({ readable: false, line: 2 });
    expect(parseWithholdingTableText("0 0%\n7,500 19,900 10%")).toEqual({ readable: false, line: 2 });
  });
});
