import { describe, expect, it } from "vitest";
import { excerptHeadAndTail } from "./excerpt-head-and-tail";

describe("excerptHeadAndTail", () => {
  it("returns short text whole", () => {
    expect(excerptHeadAndTail("banner\nerror", 100)).toBe("banner\nerror");
  });

  it("keeps the tail, where a CLI puts its error after the banner", () => {
    const text = `${"banner ".repeat(60)}ERROR: you've hit your usage limit; try again in 2h 30m`;
    const out = excerptHeadAndTail(text, 200);
    expect(out).toContain("hit your usage limit");
    expect(out).toContain("chars elided");
    expect(out.length).toBeLessThan(text.length);
  });
});
