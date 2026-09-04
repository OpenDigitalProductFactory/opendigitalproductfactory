import { describe, expect, it, vi } from "vitest";

import {
  observeRescueSource,
  rescueDayWindow,
  resolveRescueOrganizationScope,
  type RescueScopeDb,
} from "./cockpit-loader";

function scopeDb(input: {
  activeOrganizationId?: string | null;
  organizations?: Array<{ id: string }>;
  configs?: Record<string, {
    organizationId: string;
    timezone: string;
    archetype: { archetypeId: string };
  }>;
}): RescueScopeDb {
  return {
    platformSetupProgress: {
      findUnique: vi.fn(async () => ({
        organizationId: input.activeOrganizationId ?? null,
      })),
    },
    organization: {
      findMany: vi.fn(async () => input.organizations ?? []),
    },
    storefrontConfig: {
      findUnique: vi.fn(async (args: unknown) => {
        const organizationId = (args as { where: { organizationId: string } }).where.organizationId;
        return input.configs?.[organizationId] ?? null;
      }),
    },
  };
}

describe("Pet Rescue organization scope", () => {
  it("uses the signed-in user's active organization when it is Pet Rescue", async () => {
    const db = scopeDb({
      activeOrganizationId: "org-active",
      configs: {
        "org-active": {
          organizationId: "org-active",
          timezone: "America/Chicago",
          archetype: { archetypeId: "pet-rescue" },
        },
      },
    });

    await expect(resolveRescueOrganizationScope("user-1", db)).resolves.toEqual({
      organizationId: "org-active",
      timeZone: "America/Chicago",
    });
  });

  it("uses the storefront timezone for the care-due calendar day", () => {
    const window = rescueDayWindow(
      new Date("2026-09-04T04:30:00.000Z"),
      "America/Chicago",
    );

    expect(window.start.toISOString()).toBe("2026-09-03T05:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-09-04T05:00:00.000Z");
  });

  it("fails closed when an unmapped user has two organizations and only the later one is Pet Rescue", async () => {
    const db = scopeDb({
      organizations: [{ id: "org-canonical" }, { id: "org-later" }],
      configs: {
        "org-later": {
          organizationId: "org-later",
          timezone: "UTC",
          archetype: { archetypeId: "pet-rescue" },
        },
      },
    });

    await expect(resolveRescueOrganizationScope("user-unmapped", db)).resolves.toBeNull();
    expect(db.storefrontConfig.findUnique).not.toHaveBeenCalled();
  });

  it("does not cross into a later Pet Rescue organization when the active organization uses another archetype", async () => {
    const db = scopeDb({
      activeOrganizationId: "org-active",
      organizations: [{ id: "org-active" }, { id: "org-later" }],
      configs: {
        "org-active": {
          organizationId: "org-active",
          timezone: "America/New_York",
          archetype: { archetypeId: "restaurant" },
        },
        "org-later": {
          organizationId: "org-later",
          timezone: "America/Los_Angeles",
          archetype: { archetypeId: "pet-rescue" },
        },
      },
    });

    await expect(resolveRescueOrganizationScope("user-1", db)).resolves.toBeNull();
    expect(db.storefrontConfig.findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not expose database errors through source status", async () => {
    const result = await observeRescueSource({
      load: async () => { throw new Error("postgres://secret-host/private-table"); },
      isEmpty: () => false,
      unavailableReason: "Animal records could not be read.",
      asOf: "2026-09-04T12:00:00.000Z",
    });

    expect(result).toEqual({
      state: "unavailable",
      data: null,
      reason: "Animal records could not be read.",
      asOf: "2026-09-04T12:00:00.000Z",
    });
    expect(result.reason).not.toContain("secret-host");
  });
});
