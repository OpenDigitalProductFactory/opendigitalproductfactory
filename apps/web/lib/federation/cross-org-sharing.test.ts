import { describe, expect, it } from "vitest";

import {
  assertMayCrossOrgBoundary,
  DEFAULT_BACKLOG_SENSITIVITY,
  isBacklogSensitivity,
  mayCrossOrgBoundary,
  normalizeSensitivity,
} from "./cross-org-sharing";

describe("normalizeSensitivity", () => {
  it("keeps valid values and defaults everything else to the safe internal", () => {
    expect(normalizeSensitivity("public")).toBe("public");
    expect(normalizeSensitivity("confidential")).toBe("confidential");
    expect(normalizeSensitivity(undefined)).toBe("internal");
    expect(normalizeSensitivity(null)).toBe("internal");
    expect(normalizeSensitivity("bogus")).toBe("internal");
    expect(DEFAULT_BACKLOG_SENSITIVITY).toBe("internal");
  });
});

describe("mayCrossOrgBoundary — deny-by-default (DI-3E77E48D5710)", () => {
  it("permits ONLY explicitly public items across an org boundary", () => {
    expect(mayCrossOrgBoundary("public")).toBe(true);
  });

  it.each(["internal", "confidential", "restricted", undefined, null, "bogus"])(
    "denies %s (unclassified/proprietary never leaks upstream)",
    (value) => {
      expect(mayCrossOrgBoundary(value)).toBe(false);
    },
  );
});

describe("assertMayCrossOrgBoundary", () => {
  it("passes for public and throws an operator-facing refusal otherwise", () => {
    expect(() => assertMayCrossOrgBoundary("public")).not.toThrow();
    expect(() => assertMayCrossOrgBoundary("internal")).toThrow(/does not permit cross-organization sharing/);
    expect(() => assertMayCrossOrgBoundary(undefined)).toThrow(/Mark it "public"/);
  });
});

describe("isBacklogSensitivity", () => {
  it.each([
    ["public", true],
    ["restricted", true],
    ["", false],
    ["Public", false],
    [3, false],
  ])("isBacklogSensitivity(%s) === %s", (value, expected) => {
    expect(isBacklogSensitivity(value)).toBe(expected);
  });
});
