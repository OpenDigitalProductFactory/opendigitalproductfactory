import { describe, it, expect } from "vitest";

import { isRecord, asString, asNumber } from "./coerce";

describe("isRecord", () => {
  it("is true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it("is false for arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("s")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  it("narrows for safe property access on unknown", () => {
    const v: unknown = { name: "x" };
    if (isRecord(v)) {
      expect(v.name).toBe("x");
    } else {
      throw new Error("expected record");
    }
  });
});

describe("asString", () => {
  it("returns the value when it is a string", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString("")).toBe("");
  });

  it("returns the fallback (default undefined) for non-strings", () => {
    expect(asString(1)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
    expect(asString({})).toBeUndefined();
    expect(asString(3, "def")).toBe("def");
  });

  it("does not stringify non-strings", () => {
    expect(asString(42)).toBeUndefined();
    expect(asString(true)).toBeUndefined();
  });
});

describe("asNumber", () => {
  it("returns finite numbers as-is, including 0", () => {
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-5)).toBe(-5);
    expect(asNumber(3.14)).toBe(3.14);
  });

  it("rejects NaN and Infinity", () => {
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber(Infinity)).toBeUndefined();
    expect(asNumber(-Infinity, 0)).toBe(0);
  });

  it("returns the fallback (default undefined) for non-numbers", () => {
    expect(asNumber("3")).toBeUndefined();
    expect(asNumber(null)).toBeUndefined();
    expect(asNumber(undefined)).toBeUndefined();
    expect(asNumber("3", 9)).toBe(9);
  });
});
