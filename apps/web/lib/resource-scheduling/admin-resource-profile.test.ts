import { describe, expect, it } from "vitest";

import {
  assertAdminRosterWithinLimit,
  isAdminResourceCapacityValid,
  resolveAdminResourceProfile,
} from "./admin-resource-profile";

const processProfile = {
  catalogModes: ["priced"] as const,
  subjectTypes: [],
  housesSubjects: false,
  schedulesSubjects: false,
  resourceKinds: [
    { kindSlug: "table", capacityUnit: "seats", maxCapacity: 100 },
    { kindSlug: "room", capacityUnit: "guests", maxCapacity: 500 },
  ],
};

describe("admin resource profile", () => {
  it("resolves kind, capacity unit, and limit from process configuration", () => {
    expect(resolveAdminResourceProfile(processProfile, "table")).toEqual({
      kindSlug: "table",
      capacityUnit: "seats",
      maxCapacity: 100,
    });
  });

  it("validates capacity against the configured resource limit", () => {
    const profile = resolveAdminResourceProfile(processProfile, "room");
    expect(profile).not.toBeNull();
    expect(isAdminResourceCapacityValid(500, profile!)).toBe(true);
    expect(isAdminResourceCapacityValid(501, profile!)).toBe(false);
  });

  it("rejects an undeclared resource kind", () => {
    expect(resolveAdminResourceProfile(processProfile, "kennel")).toBeNull();
  });

  it("enforces the bounded 5,000-row admin roster", () => {
    expect(() => assertAdminRosterWithinLimit(5_000)).not.toThrow();
    expect(() => assertAdminRosterWithinLimit(5_001)).toThrow("RESOURCE_ROSTER_LIMIT");
  });
});
