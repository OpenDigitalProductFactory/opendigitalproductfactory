import { describe, expect, it, vi } from "vitest";

import { createPrismaSceneEntityLookup } from "./scene-entity-resolver.server";

function database() {
  return {
    organization: {
      findUnique: vi.fn(async () => ({ id: "org-row", orgId: "org-public" })),
    },
    careResource: {
      findMany: vi.fn(async () => [
        {
          id: "care-1",
          name: "Treatment room 1",
          resourceType: "room",
          isActive: true,
        },
      ]),
    },
    rentableUnit: {
      findMany: vi.fn(async () => [
        { id: "unit-1", label: "Excavator 12", status: "available" },
      ]),
    },
    customerSite: {
      findMany: vi.fn(async () => [
        { id: "site-1", name: "North campus", siteType: "office", status: "active" },
      ]),
    },
    customerConfigurationItem: {
      findMany: vi.fn(async () => [
        { id: "ci-1", name: "Roof unit 4", ciType: "hvac", status: "active" },
      ]),
    },
    serviceProvider: {
      findMany: vi.fn(async () => [
        { id: "table-1", name: "Table 1", isActive: true },
        { id: "staff-1", name: "Morgan Lee", isActive: true },
      ]),
    },
  };
}

describe("createPrismaSceneEntityLookup", () => {
  it("resolves the public organization scope once", async () => {
    const db = database();
    const lookup = createPrismaSceneEntityLookup(db);

    await expect(lookup.resolveOrganization("org-public")).resolves.toEqual({
      id: "org-row",
      orgId: "org-public",
    });
    expect(db.organization.findUnique).toHaveBeenCalledWith({
      where: { orgId: "org-public" },
      select: { id: true, orgId: true },
    });
  });

  it("scopes tenant-bearing resource kinds and selects only render-time fields", async () => {
    const db = database();
    const lookup = createPrismaSceneEntityLookup(db);
    const organization = { id: "org-row", orgId: "org-public" };

    await lookup.findMany({
      kind: "care-resource",
      ids: ["care-1"],
      organization,
    });
    await lookup.findMany({
      kind: "rentable-unit",
      ids: ["unit-1"],
      organization,
    });
    const tables = await lookup.findMany({
      kind: "table",
      ids: ["table-1", "staff-1"],
      organization,
    });

    expect(db.careResource.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-row", id: { in: ["care-1"] } },
      select: {
        id: true,
        name: true,
        resourceType: true,
        isActive: true,
      },
    });
    expect(db.rentableUnit.findMany).toHaveBeenCalledWith({
      where: {
        storefront: { organizationId: "org-row" },
        id: { in: ["unit-1"] },
      },
      select: { id: true, label: true, status: true },
    });
    expect(db.serviceProvider.findMany).toHaveBeenCalledWith({
      where: {
        storefront: { organizationId: "org-row" },
        id: { in: ["table-1", "staff-1"] },
      },
      select: { id: true, name: true, isActive: true },
    });
    expect(tables).toEqual([
      {
        entityKind: "table",
        id: "table-1",
        label: "Table 1",
        operationalStatus: "active",
        active: true,
        entityType: "table",
      },
    ]);
  });

  it("resolves install-local customer sites and infrastructure CIs by requested id only", async () => {
    const db = database();
    const lookup = createPrismaSceneEntityLookup(db);
    const organization = { id: "org-row", orgId: "org-public" };

    await expect(
      lookup.findMany({ kind: "customer-site", ids: ["site-1"], organization }),
    ).resolves.toEqual([
      {
        entityKind: "customer-site",
        id: "site-1",
        label: "North campus",
        operationalStatus: "active",
        active: true,
        entityType: "office",
      },
    ]);
    await expect(
      lookup.findMany({ kind: "infra-ci", ids: ["ci-1"], organization }),
    ).resolves.toEqual([
      {
        entityKind: "infra-ci",
        id: "ci-1",
        label: "Roof unit 4",
        operationalStatus: "active",
        active: true,
        entityType: "hvac",
      },
    ]);

    expect(db.customerSite.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["site-1"] } },
      select: { id: true, name: true, siteType: true, status: true },
    });
    expect(db.customerConfigurationItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ci-1"] } },
      select: { id: true, name: true, ciType: true, status: true },
    });
  });
});
