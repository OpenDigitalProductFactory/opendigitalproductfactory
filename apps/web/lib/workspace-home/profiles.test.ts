import { describe, expect, it } from "vitest";

import { ARCHETYPE_SEED_DATA } from "../../../../packages/storefront-templates/src/seed";
import {
  defaultWorkspaceHomeRegistry,
  resolveWorkspaceHomeContribution,
  validateWorkspaceHomeContribution,
} from "./registry";

describe("default workspace home profiles", () => {
  it("keeps every registered profile valid and concern-led", () => {
    for (const contribution of defaultWorkspaceHomeRegistry.contributions) {
      const validation = validateWorkspaceHomeContribution(contribution);

      expect(validation.ok, `${contribution.id}: ${validation.errors.join("; ")}`).toBe(true);
      expect(contribution.primaryOperatingQuestion, contribution.id).toBeTruthy();
      expect(contribution.topConcerns.length, contribution.id).toBeGreaterThanOrEqual(3);
      expect(contribution.slots.every((slot) => slot.zone !== undefined), contribution.id).toBe(true);
    }
  });

  it("covers every seeded archetype through an exact or category profile", () => {
    const uncovered: string[] = [];

    for (const archetype of ARCHETYPE_SEED_DATA) {
      const resolution = resolveWorkspaceHomeContribution({
        storefrontConfig: {
          archetype: {
            archetypeId: archetype.archetypeId,
            category: archetype.category,
            name: archetype.name,
          },
        },
      });

      if (resolution.mode !== "vertical") {
        uncovered.push(`${archetype.archetypeId} (${archetype.category})`);
      }
    }

    expect(uncovered).toEqual([]);
  });

  it("uses exact profiles for waste-management and fractional-CXO operating models", () => {
    const waste = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "waste-management",
          category: "moving-and-logistics",
          name: "Waste Management Company",
        },
      },
    });
    const fractional = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "fractional-cxo",
          category: "professional-services",
          name: "Fractional CXO",
        },
      },
    });

    expect(waste.match).toBe("exact");
    expect(waste.contribution?.id).toBe("home-waste-management");
    expect(waste.contribution?.topConcerns).toContain("missed pickups or contaminated loads");

    expect(fractional.match).toBe("exact");
    expect(fractional.contribution?.id).toBe("home-fractional-cxo");
    expect(fractional.contribution?.topConcerns).toContain(
      "client decisions awaiting executive input",
    );
  });
});
