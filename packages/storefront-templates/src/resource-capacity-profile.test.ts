import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import {
  RESOURCE_CAPACITY_AUTHORITIES,
  RESOURCE_CAPACITY_PATTERNS,
  deriveResourceCapacityProfile,
} from "./resource-capacity-profile";

function archetype(archetypeId: string) {
  const match = ALL_ARCHETYPES.find((item) => item.archetypeId === archetypeId);
  if (!match) throw new Error(`Missing archetype fixture ${archetypeId}`);
  return match;
}

describe("deriveResourceCapacityProfile", () => {
  it.each([
    ["hair-salon", "appointment", "provider-calendar"],
    ["hvac-contractor", "dispatch", "field-operations"],
    ["equipment-rental", "rental", "rental"],
    ["gym", "class", "provider-calendar"],
    ["event-venue", "venue", "venue-operations"],
    ["new-home-builder", "project-resource", "field-operations"],
  ] as const)("maps %s to the %s capacity pattern", (archetypeId, pattern, authority) => {
    const profile = deriveResourceCapacityProfile(archetype(archetypeId));

    expect(profile.enabled).toBe(true);
    expect(profile.patterns).toContain(pattern);
    expect(profile.authorities).toContain(authority);
  });

  it("keeps mobile beauty on the dispatch/travel path", () => {
    const profile = deriveResourceCapacityProfile(archetype("mobile-beauty"));

    expect(profile.patterns).toContain("dispatch");
    expect(profile.authorities).not.toContain("beauty");
    expect(profile.supportsTravel).toBe(true);
  });

  it.each(["hair-salon", "barber-shop", "nail-salon", "beauty-spa"])(
    "adds beauty-owned physical resources to fixed-premises %s appointments",
    (archetypeId) => {
      const profile = deriveResourceCapacityProfile(archetype(archetypeId));

      expect(profile.patterns).toContain("appointment");
      expect(profile.authorities).toEqual(
        expect.arrayContaining(["provider-calendar", "staffing", "beauty"]),
      );
    },
  );

  it("represents existing restaurant and room occupancy authorities", () => {
    expect(deriveResourceCapacityProfile(archetype("restaurant"))).toMatchObject({
      patterns: ["service-floor"],
      authorities: expect.arrayContaining(["hospitality"]),
    });
    expect(deriveResourceCapacityProfile(archetype("pet-boarding"))).toMatchObject({
      patterns: ["occupancy"],
    });
  });

  it("does not manufacture physical capacity for board-only archetypes", () => {
    const profile = deriveResourceCapacityProfile(archetype("software-platform"));

    expect(profile.enabled).toBe(false);
    expect(profile.patterns).toEqual([]);
    expect(profile.authorities).toEqual([]);
  });

  it("returns only closed pattern and authority values for every archetype", () => {
    for (const definition of ALL_ARCHETYPES) {
      const profile = deriveResourceCapacityProfile(definition);
      for (const pattern of profile.patterns) {
        expect(RESOURCE_CAPACITY_PATTERNS).toContain(pattern);
      }
      for (const authority of profile.authorities) {
        expect(RESOURCE_CAPACITY_AUTHORITIES).toContain(authority);
      }
    }
  });
});
