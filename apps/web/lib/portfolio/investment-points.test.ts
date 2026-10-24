import { describe, expect, it } from "vitest";

import { quarterBounds, resolveInvestmentPoints } from "./investment-points";

describe("resolveInvestmentPoints (BI-298A7202)", () => {
  it("takes an agreed estimate first", () => {
    expect(resolveInvestmentPoints({ estimateAgreed: true, jobSize: 5, effortSize: "large" }))
      .toEqual({ points: 5, source: "agreed" });
  });

  it("falls back to an unagreed estimate, then the size default on the 1/3/8/20 scale", () => {
    expect(resolveInvestmentPoints({ estimateAgreed: false, jobSize: 5, effortSize: "large" }))
      .toEqual({ points: 5, source: "estimate" });
    expect(resolveInvestmentPoints({ estimateAgreed: true, jobSize: null, effortSize: "large" }))
      .toEqual({ points: 8, source: "size-default" });
    expect(resolveInvestmentPoints({ effortSize: "small" })).toEqual({ points: 1, source: "size-default" });
    expect(resolveInvestmentPoints({ effortSize: "medium" })).toEqual({ points: 3, source: "size-default" });
    expect(resolveInvestmentPoints({ effortSize: "xlarge" })).toEqual({ points: 20, source: "size-default" });
  });

  it("is unsized, never guessed, when nothing sizes the item", () => {
    expect(resolveInvestmentPoints({})).toEqual({ points: null, source: "unsized" });
    expect(resolveInvestmentPoints({ jobSize: 0, effortSize: "huge" })).toEqual({ points: null, source: "unsized" });
  });
});

describe("quarterBounds", () => {
  it("returns the UTC calendar quarter containing the instant", () => {
    expect(quarterBounds(new Date("2026-09-25T12:00:00Z"))).toEqual({
      start: new Date("2026-07-01T00:00:00Z"),
      end: new Date("2026-10-01T00:00:00Z"),
    });
    expect(quarterBounds(new Date("2026-01-01T00:00:00Z")).start).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(quarterBounds(new Date("2026-12-31T23:59:59Z")).end).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});
