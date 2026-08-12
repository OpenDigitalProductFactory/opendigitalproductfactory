import { describe, expect, it } from "vitest";

import {
  compareVersionVectors,
  dominatesOrEqual,
  incrementVersionVector,
  isVersionVector,
  mergeVersionVectors,
} from "./version-vector";

describe("isVersionVector", () => {
  it.each([
    [{ inst_a: 0, inst_b: 3 }, true],
    [{}, true],
    [{ inst_a: -1 }, false],
    [{ inst_a: 1.5 }, false],
    [{ inst_a: "3" }, false],
    [{ "": 1 }, false],
    [null, false],
    [[1, 2], false],
  ])("isVersionVector(%o) === %s", (value, expected) => {
    expect(isVersionVector(value)).toBe(expected);
  });
});

describe("compareVersionVectors", () => {
  it("equal for identical vectors (missing key ≡ 0)", () => {
    expect(compareVersionVectors({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe("equal");
    expect(compareVersionVectors({ a: 0 }, {})).toBe("equal");
  });

  it("dominates when strictly newer in every dimension", () => {
    expect(compareVersionVectors({ a: 2, b: 2 }, { a: 1, b: 2 })).toBe("dominates");
    expect(compareVersionVectors({ a: 1 }, {})).toBe("dominates");
  });

  it("dominated is the mirror of dominates", () => {
    expect(compareVersionVectors({ a: 1, b: 2 }, { a: 2, b: 2 })).toBe("dominated");
  });

  it("concurrent when each leads in a different dimension (a real conflict)", () => {
    expect(compareVersionVectors({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe("concurrent");
    // customer closed (bumps its own counter) while reseller updated concurrently
    expect(compareVersionVectors({ customer: 1 }, { reseller: 1 })).toBe("concurrent");
  });
});

describe("dominatesOrEqual", () => {
  it("accepts an equal or strictly-newer incoming vector, rejects older/concurrent", () => {
    expect(dominatesOrEqual({ a: 2 }, { a: 1 })).toBe(true);
    expect(dominatesOrEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(dominatesOrEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(dominatesOrEqual({ a: 2, b: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("mergeVersionVectors", () => {
  it("is the entrywise max (least upper bound)", () => {
    expect(mergeVersionVectors({ a: 2, b: 1 }, { a: 1, b: 3, c: 5 })).toEqual({ a: 2, b: 3, c: 5 });
  });

  it("a merged vector dominates (or equals) both inputs", () => {
    const a = { a: 2, b: 1 };
    const b = { a: 1, b: 2 };
    const m = mergeVersionVectors(a, b);
    expect(dominatesOrEqual(m, a)).toBe(true);
    expect(dominatesOrEqual(m, b)).toBe(true);
  });
});

describe("incrementVersionVector", () => {
  it("advances only the local installation's counter and returns a new object", () => {
    const v = { peer: 5 };
    const next = incrementVersionVector(v, "self");
    expect(next).toEqual({ peer: 5, self: 1 });
    expect(v).toEqual({ peer: 5 }); // input unchanged
    expect(incrementVersionVector(next, "self")).toEqual({ peer: 5, self: 2 });
  });

  it("makes the local edit strictly newer than what it was based on", () => {
    const base = { self: 1, peer: 3 };
    expect(compareVersionVectors(incrementVersionVector(base, "self"), base)).toBe("dominates");
  });

  it("requires an installation id", () => {
    expect(() => incrementVersionVector({}, "")).toThrow();
  });
});
