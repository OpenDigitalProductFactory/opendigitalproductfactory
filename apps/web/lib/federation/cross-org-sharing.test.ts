import { describe, expect, it } from "vitest";

import {
  assertMayCrossOrgBoundary,
  isPlatformScopedDemand,
  mayShareDemandCrossOrg,
  mayShareSameOrgDemand,
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

describe("isPlatformScopedDemand", () => {
  it("is true for dpf-portal digitalProduct or scopeKind platform", () => {
    expect(isPlatformScopedDemand({ digitalProductId: "dpf-portal" })).toBe(true);
    expect(isPlatformScopedDemand({ scopeKind: "platform" })).toBe(true);
  });
  it("is false for a customer's own business domain", () => {
    expect(isPlatformScopedDemand({ digitalProductId: "acme-widgets", scopeKind: "archetype-leaf" })).toBe(false);
    expect(isPlatformScopedDemand({})).toBe(false);
  });
});

describe("mayShareDemandCrossOrg — context-derived, automatic (BI-DC4E526E)", () => {
  it("auto-permits PLATFORM demand upstream with no manual flag (default internal)", () => {
    expect(mayShareDemandCrossOrg({ digitalProductId: "dpf-portal" })).toBe(true);
    expect(mayShareDemandCrossOrg({ scopeKind: "platform", sensitivity: "internal" })).toBe(true);
  });
  it("auto-denies customer-domain demand by default (no manual step to stay private)", () => {
    expect(mayShareDemandCrossOrg({ digitalProductId: "acme-widgets", sensitivity: "internal" })).toBe(false);
    expect(mayShareDemandCrossOrg({})).toBe(false);
  });
  it("lets an explicit public release a customer-domain item (rare override)", () => {
    expect(mayShareDemandCrossOrg({ digitalProductId: "acme-widgets", sensitivity: "public" })).toBe(true);
  });
  it("hard-blocks confidential/restricted even for platform demand", () => {
    expect(mayShareDemandCrossOrg({ digitalProductId: "dpf-portal", sensitivity: "confidential" })).toBe(false);
    expect(mayShareDemandCrossOrg({ scopeKind: "platform", sensitivity: "restricted" })).toBe(false);
  });
});

describe("mayShareSameOrgDemand — trust-by-default within one org (BI-8A7E3E56 follow-up)", () => {
  it("shares all non-sensitive backlog regardless of product/scope tag", () => {
    expect(mayShareSameOrgDemand("internal")).toBe(true);   // the default — shares same-org
    expect(mayShareSameOrgDemand("public")).toBe(true);
    expect(mayShareSameOrgDemand(undefined)).toBe(true);    // untagged defaults to internal → shares
    expect(mayShareSameOrgDemand(null)).toBe(true);
  });
  it("keeps the genuinely-sensitive tier local even same-org (HR/confidential)", () => {
    expect(mayShareSameOrgDemand("confidential")).toBe(false);
    expect(mayShareSameOrgDemand("restricted")).toBe(false);
  });
});
