import { describe, expect, it, vi } from "vitest";

import { resolvePerformanceOrganizationContext } from "./performance-organization-context";

describe("resolvePerformanceOrganizationContext", () => {
  it("uses the authenticated user's current organization", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: "org-current" })),
      },
      storefrontConfig: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-current",
          archetype: { archetypeId: "restaurant" },
        })),
        findMany: vi.fn(),
      },
    };

    await expect(
      resolvePerformanceOrganizationContext(db, "user-owner"),
    ).resolves.toEqual({
      status: "resolved",
      organizationId: "org-current",
      archetypeId: "restaurant",
    });
    expect(db.storefrontConfig.findMany).not.toHaveBeenCalled();
  });

  it("refuses an unmapped user when more than one organization exists", async () => {
    const db = {
      platformSetupProgress: {
        findUnique: vi.fn(async () => ({ organizationId: null })),
      },
      storefrontConfig: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => [
          { organizationId: "org-a", archetype: { archetypeId: "restaurant" } },
          { organizationId: "org-b", archetype: { archetypeId: "restaurant" } },
        ]),
      },
    };

    const result = await resolvePerformanceOrganizationContext(db, "user-unmapped");

    expect(result).toEqual({
      status: "unconfigured",
      reason:
        "We could not determine your current organization, so no performance data was loaded.",
    });
    expect(db.storefrontConfig.findUnique).not.toHaveBeenCalled();
  });
});
