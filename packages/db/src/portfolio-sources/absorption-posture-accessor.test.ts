import { describe, expect, it, vi } from "vitest";
import { postureForArchetype } from "./absorption-posture.js";

// P2 accessor test (BI-264FB4D8). The PrismaClient import is type-only (erased
// at runtime), so a plain mock stands in — this runs in the source-only
// worktree without the generated client. Verifies the accessor queries by
// array-containment on archetypeIds and returns the projected rows the three
// consumers (boundary-map, coverage stage-1 default, onboarding prefill) read.

describe("postureForArchetype", () => {
  it("filters by archetypeId containment and returns projected rows", async () => {
    const found = [
      {
        providerName: "Mindbody",
        integrationCategory: "fitness-management",
        connectorTier: "tier3-bespoke",
        verdict: "provider_led",
        status: "proposed",
        coveringPrimitive: null,
      },
    ];
    const findMany = vi.fn().mockResolvedValue(found);
    const prisma = { absorptionPosture: { findMany } } as never;

    const result = await postureForArchetype(prisma, "gym");

    expect(findMany).toHaveBeenCalledOnce();
    const arg = findMany.mock.calls[0]![0];
    expect(arg.where).toEqual({ archetypeIds: { has: "gym" } });
    // ordered tier then provider so the surface renders shared-first.
    expect(arg.orderBy).toEqual([
      { connectorTier: "asc" },
      { providerName: "asc" },
    ]);
    expect(result).toEqual(found);
  });

  it("returns an empty list when no incumbents map to the archetype", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { absorptionPosture: { findMany } } as never;
    expect(await postureForArchetype(prisma, "unmapped-archetype")).toEqual([]);
  });
});
