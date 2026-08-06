import { describe, it, expect } from "vitest";
import {
  selectJurisdictionProfile,
  applyJurisdictionCriteria,
  type JurisdictionCriteriaProfileLike,
} from "./jurisdiction-criteria";

function profile(over: Partial<JurisdictionCriteriaProfileLike> = {}): JurisdictionCriteriaProfileLike {
  return {
    profileKey: "p",
    version: 1,
    industry: null,
    jurisdiction: "global",
    jurisdictionBasis: "global",
    activityClass: "hiring",
    requiredAxes: [],
    forbiddenAxes: [],
    monitoringOnlyAxes: [],
    weightOverlay: {},
    packVersion: null,
    status: "active",
    ...over,
  };
}

describe("jurisdiction-criteria", () => {
  it("selects the most specific active applicable profile", () => {
    const profiles = [
      profile({ profileKey: "global", jurisdiction: "global" }),
      profile({ profileKey: "ny", jurisdiction: "US-NY", packVersion: "LL144-2026" }),
      profile({ profileKey: "ny-inactive", jurisdiction: "US-NY", status: "retired" }),
    ];
    const regime = selectJurisdictionProfile(profiles, {
      jurisdiction: "US-NY",
      activityClass: "hiring",
    });
    expect(regime?.profileKey).toBe("ny");
    expect(regime?.packVersion).toBe("LL144-2026");
  });

  it("falls back to a global profile when no jurisdiction-specific one matches", () => {
    const regime = selectJurisdictionProfile([profile({ profileKey: "g" })], {
      jurisdiction: "US-CA",
      activityClass: "hiring",
    });
    expect(regime?.profileKey).toBe("g");
  });

  it("returns null when activityClass does not match any profile", () => {
    const regime = selectJurisdictionProfile([profile({ activityClass: "hiring" })], {
      jurisdiction: "global",
      activityClass: "credit",
    });
    expect(regime).toBeNull();
  });

  it("strips forbidden and monitoring-only axes and applies the weight overlay", () => {
    const regime = selectJurisdictionProfile(
      [
        profile({
          jurisdiction: "US-NY",
          forbiddenAxes: ["blast_radius"],
          monitoringOnlyAxes: ["public_safety"],
          weightOverlay: { governance_compliance: 1.5 },
          requiredAxes: ["governance_compliance"],
        }),
      ],
      { jurisdiction: "US-NY", activityClass: "hiring" },
    );
    const applied = applyJurisdictionCriteria({
      options: [
        {
          id: "cand",
          description: "c",
          features: { governance_compliance: 0.8, blast_radius: 0.3, public_safety: 0.6 },
        },
      ],
      regime,
    });
    // forbidden + monitoring-only removed; governance kept, overlay applied & clamped
    expect(applied.options[0].features).toEqual({ governance_compliance: 1 }); // 0.8*1.5 clamped to 1
    expect(applied.forbiddenRemoved).toEqual([{ optionId: "cand", dimensionKey: "blast_radius" }]);
    expect(applied.monitoringOnlyRemoved).toEqual([{ optionId: "cand", dimensionKey: "public_safety" }]);
    expect(applied.requiredMissing).toEqual([]);
  });

  it("reports required axes that no option scores", () => {
    const regime = selectJurisdictionProfile(
      [profile({ jurisdiction: "US-NY", requiredAxes: ["governance_compliance"] })],
      { jurisdiction: "US-NY", activityClass: "hiring" },
    );
    const applied = applyJurisdictionCriteria({
      options: [{ id: "c", description: "c", features: { speed_to_value: 0.9 } }],
      regime,
    });
    expect(applied.requiredMissing).toEqual(["governance_compliance"]);
  });

  it("flags profile axes that are not real principle dimensions", () => {
    const regime = selectJurisdictionProfile(
      [profile({ jurisdiction: "US-NY", forbiddenAxes: ["not_a_real_axis"] })],
      { jurisdiction: "US-NY", activityClass: "hiring" },
    );
    const applied = applyJurisdictionCriteria({ options: [], regime });
    expect(applied.invalidProfileAxes).toContain("not_a_real_axis");
  });

  it("passes options through unchanged when no regime resolves", () => {
    const applied = applyJurisdictionCriteria({
      options: [{ id: "c", description: "c", features: { speed_to_value: 0.9 } }],
      regime: null,
    });
    expect(applied.options[0].features).toEqual({ speed_to_value: 0.9 });
  });
});
