import { describe, it, expect } from "vitest";
import {
  deriveMediaProfile,
  getMediaProfile,
  getRequiredMediaSlots,
} from "./media-profile";
import { ALL_ARCHETYPES } from "./archetypes/index";
import type { MediaRole } from "./types";

function rolesFor(archetypeId: string): Set<MediaRole> {
  return new Set((getMediaProfile(archetypeId)?.slots ?? []).map((s) => s.role));
}

function requiredRolesFor(archetypeId: string): Set<MediaRole> {
  return new Set(getRequiredMediaSlots(archetypeId).map((s) => s.role));
}

describe("deriveMediaProfile", () => {
  it("returns a profile for every archetype, and every archetype gets a logo slot", () => {
    for (const a of ALL_ARCHETYPES) {
      const profile = deriveMediaProfile(a);
      expect(profile.slots.length, `${a.archetypeId} has no media slots`).toBeGreaterThan(0);
      expect(
        profile.slots.some((s) => s.role === "logo"),
        `${a.archetypeId} should always have a logo slot`,
      ).toBe(true);
    }
  });

  it("purchase catalogues require product photos (retail)", () => {
    expect(requiredRolesFor("retail-goods")).toContain("product");
    expect(requiredRolesFor("florist")).toContain("product");
  });

  it("food & hospitality require product (food) photos even without purchase CTA", () => {
    const restaurant = ALL_ARCHETYPES.find((a) => a.category === "food-hospitality");
    expect(restaurant, "expected a food-hospitality archetype").toBeTruthy();
    expect(requiredRolesFor(restaurant!.archetypeId)).toContain("product");
  });

  it("asset-rental requires equipment photos", () => {
    expect(requiredRolesFor("equipment-rental")).toContain("equipment");
  });

  it("adoption archetypes require animal photos", () => {
    expect(requiredRolesFor("pet-rescue")).toContain("animal");
    expect(requiredRolesFor("animal-shelter")).toContain("animal");
  });

  it("beauty/grooming surface a before-after slot", () => {
    // hair-salon has a gallery section in the beauty category.
    const beauty = ALL_ARCHETYPES.find(
      (a) => a.category === "beauty-personal-care" && a.sectionTemplates.some((s) => s.type === "gallery"),
    );
    if (beauty) {
      expect(rolesFor(beauty.archetypeId)).toContain("before-after");
    }
    // pet-grooming is called out by id regardless of category.
    if (ALL_ARCHETYPES.some((a) => a.archetypeId === "pet-grooming")) {
      expect(rolesFor("pet-grooming")).toContain("before-after");
    }
  });

  it("image-light professional services do not require any gallery", () => {
    const accounting = ALL_ARCHETYPES.find((a) => a.archetypeId === "accounting");
    if (accounting) {
      expect(requiredRolesFor("accounting").size).toBe(0);
    }
  });

  it("archetypes with a team section get an avatar slot", () => {
    for (const a of ALL_ARCHETYPES) {
      if (a.sectionTemplates.some((s) => s.type === "team")) {
        expect(rolesFor(a.archetypeId), `${a.archetypeId} team → avatar`).toContain("avatar");
      }
    }
  });

  it("an explicit mediaProfile override is returned verbatim", () => {
    const override = {
      slots: [
        {
          role: "hero" as const,
          owner: "storefront" as const,
          applicability: "required" as const,
          multiple: false,
          label: "X",
          reason: "Y",
        },
      ],
    };
    const profile = deriveMediaProfile({
      ...ALL_ARCHETYPES[0],
      mediaProfile: override,
    });
    expect(profile).toEqual(override);
  });

  it("getMediaProfile returns undefined for an unknown archetype", () => {
    expect(getMediaProfile("does-not-exist")).toBeUndefined();
  });
});
