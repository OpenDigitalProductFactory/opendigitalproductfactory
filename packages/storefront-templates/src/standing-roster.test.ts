import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveStandingRooms } from "./standing-rooms";
import { deriveRequiredRoster, STANDING_SHAPE_REQUIRED_AGENT } from "./standing-roster";

const florist = ALL_ARCHETYPES.find((leaf) => leaf.archetypeId === "florist");
const software = ALL_ARCHETYPES.find((leaf) => leaf.archetypeId === "software-platform");

describe("deriveRequiredRoster", () => {
  it("resolves a non-empty roster for every leaf archetype", () => {
    expect(florist).toBeDefined();
    expect(software).toBeDefined();
    for (const leaf of ALL_ARCHETYPES) {
      const roster = deriveRequiredRoster(leaf);
      expect(roster.length, leaf.archetypeId).toBeGreaterThan(0);
      expect(new Set(roster.map((role) => role.agentSlug)).size).toBe(roster.length);
    }
  });

  it("joins unique agent slugs from driven rooms and skips group rooms", () => {
    const roster = deriveRequiredRoster(florist!);
    const slugs = roster.map((role) => role.agentSlug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "security-engineer",
        "customer-advisor",
        "finance-controller",
        "platform-engineer",
      ]),
    );
    expect(slugs).not.toContain("change-reviewer");
    expect(slugs).not.toContain("portfolio-advisor");
    expect(slugs).not.toContain("build-specialist");
    expect(roster.every((role) => role.shapeKeys.length > 0)).toBe(true);
  });

  it("adds software-delivery specialists only when the category operates a source repository", () => {
    const slugs = deriveRequiredRoster(software!).map((role) => role.agentSlug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "change-reviewer",
        "portfolio-advisor",
        "build-specialist",
        "security-engineer",
      ]),
    );
  });

  it("covers every driven standing-room shapeKey in the frozen map", () => {
    for (const leaf of ALL_ARCHETYPES) {
      for (const room of deriveStandingRooms(leaf)) {
        if (!room.shapeKey) continue;
        expect(
          STANDING_SHAPE_REQUIRED_AGENT[room.shapeKey],
          `${leaf.archetypeId} ${room.shapeKey}`,
        ).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});
