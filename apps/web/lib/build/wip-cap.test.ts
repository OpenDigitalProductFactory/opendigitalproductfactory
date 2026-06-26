import { describe, it, expect } from "vitest";
import {
  BUILD_WIP_CAP,
  wipCapReached,
  assertWipCapacity,
  BuildWipCapError,
} from "./wip-cap";

describe("wipCapReached", () => {
  it("is false under the cap, true at/over it", () => {
    expect(wipCapReached(BUILD_WIP_CAP - 1)).toBe(false);
    expect(wipCapReached(BUILD_WIP_CAP)).toBe(true);
    expect(wipCapReached(BUILD_WIP_CAP + 3)).toBe(true);
  });

  it("respects a custom cap", () => {
    expect(wipCapReached(0, 1)).toBe(false);
    expect(wipCapReached(1, 1)).toBe(true);
  });
});

describe("assertWipCapacity", () => {
  it("allows starting when under the cap", () => {
    expect(() => assertWipCapacity(BUILD_WIP_CAP - 1)).not.toThrow();
  });

  it("throws BuildWipCapError at the cap", () => {
    expect(() => assertWipCapacity(BUILD_WIP_CAP)).toThrow(BuildWipCapError);
  });

  it("error carries code, active count, cap, and a plain-English message", () => {
    try {
      assertWipCapacity(4, 3);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildWipCapError);
      const err = e as BuildWipCapError;
      expect(err.code).toBe("BUILD_WIP_CAP_REACHED");
      expect(err.active).toBe(4);
      expect(err.cap).toBe(3);
      expect(err.message).toContain("Finish or abandon one");
    }
  });

  it("guides toward a first-class external build when the BS sandbox is full (BI-937128F6)", () => {
    try {
      assertWipCapacity(5, 3);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as BuildWipCapError;
      expect(err.message).toMatch(/external .*build/i);
      expect(err.message).toContain("§17");
    }
  });
});
