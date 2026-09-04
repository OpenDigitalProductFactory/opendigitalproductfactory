import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import {
  ResourceCommandError,
  createAdminResource,
  listAdminResources,
  resolveManagedResourceProfiles,
  updateAdminResource,
} from "./admin-resource-repository";

const profiles = [
  { kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 },
  { kindSlug: "foster-home", capacityUnit: "animals", maxCapacity: 12 },
] as const;

function client() {
  return {
    resource: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(),
    },
  };
}

describe("admin resource repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the current built-in archetype profile for an already-activated organization", () => {
    const current = ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === "pet-rescue")!;
    const staleActivationProfile = {
      ...current.activationProfile,
      processProfile: {
        ...current.activationProfile!.processProfile!,
        resourceKinds: [{ kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 }],
      },
    };
    expect(resolveManagedResourceProfiles({
      archetypeId: "pet-rescue",
      activationProfile: staleActivationProfile,
      allowedKindSlugs: ["kennel", "foster-home"],
      capacityUnit: "animals",
    })).toEqual(profiles);
  });

  it("lists only the server-scoped domain and configured kinds", async () => {
    const db = client();
    await listAdminResources({
      db,
      organizationId: "org-1",
      domain: "care",
      profiles,
    });

    expect(db.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          domain: "care",
          kindSlug: { in: ["kennel", "foster-home"] },
        },
      }),
    );
  });

  it("creates a profile-governed foster home with a stable retry key", async () => {
    const db = client();
    db.resource.create.mockResolvedValue({ id: "resource-1", version: 1 });

    await createAdminResource({
      db,
      organizationId: "org-1",
      storefrontId: "storefront-1",
      domain: "care",
      profiles,
      command: {
        label: "Northside foster",
        kindSlug: "foster-home",
        serviceArea: "Northside",
        capacity: 3,
        idempotencyKey: "setup:northside",
      },
    });

    expect(db.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        storefrontId: "storefront-1",
        domain: "care",
        kindSlug: "foster-home",
        capacity: 3,
        capacityUnit: "animals",
        resourceKey: expect.stringMatching(/^managed-/),
      }),
      select: expect.any(Object),
    });
  });

  it("rejects a create retry key already bound to different housing", async () => {
    const db = client();
    db.resource.findFirst.mockResolvedValue({
      id: "resource-existing",
      organizationId: "org-1",
      storefrontId: "storefront-1",
      domain: "care",
      kindSlug: "kennel",
      label: "D1",
      capacity: 1,
      capacityUnit: "animals",
      serviceArea: "Dog ward",
      blockedReason: null,
      lifecycle: "active",
      version: 1,
    });

    await expect(
      createAdminResource({
        db,
        organizationId: "org-1",
        storefrontId: "storefront-1",
        domain: "care",
        profiles,
        command: {
          label: "Northside foster",
          kindSlug: "foster-home",
          serviceArea: "Northside",
          capacity: 3,
          idempotencyKey: "already-used",
        },
      }),
    ).rejects.toMatchObject({ code: "resource_conflict" });
    expect(db.resource.create).not.toHaveBeenCalled();
  });

  it("rejects unconfigured kinds and capacity above the profile ceiling", async () => {
    const db = client();
    await expect(
      createAdminResource({
        db,
        organizationId: "org-1",
        storefrontId: null,
        domain: "care",
        profiles,
        command: {
          label: "Private home",
          kindSlug: "home-address",
          serviceArea: null,
          capacity: 1,
          idempotencyKey: "bad-kind",
        },
      }),
    ).rejects.toMatchObject({ code: "resource_kind_not_allowed" });
    await expect(
      createAdminResource({
        db,
        organizationId: "org-1",
        storefrontId: null,
        domain: "care",
        profiles,
        command: {
          label: "Overflow foster",
          kindSlug: "foster-home",
          serviceArea: null,
          capacity: 13,
          idempotencyKey: "too-large",
        },
      }),
    ).rejects.toBeInstanceOf(ResourceCommandError);
  });

  it("updates by organization and expected version and reports a conflict", async () => {
    const db = client();
    db.resource.findFirst.mockResolvedValue({
      id: "resource-1",
      organizationId: "org-1",
      domain: "care",
      kindSlug: "kennel",
      label: "D1",
      capacity: 1,
      capacityUnit: "animals",
      serviceArea: "Dog ward",
      blockedReason: null,
      lifecycle: "active",
      version: 2,
    });
    db.resource.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateAdminResource({
        db,
        organizationId: "org-1",
        domain: "care",
        profiles,
        resourceId: "resource-1",
        command: { expectedVersion: 1, label: "D1 clean", idempotencyKey: "rename-1" },
      }),
    ).rejects.toMatchObject({ code: "resource_conflict" });
    expect(db.resource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "resource-1", organizationId: "org-1", version: 1 },
      }),
    );
  });
});
