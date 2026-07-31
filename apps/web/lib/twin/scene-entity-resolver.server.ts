import {
  type OperationalSceneEntityKind,
  type SceneEntityLookup,
  type SceneEntityLookupInput,
  type SceneEntityRecord,
  type SceneOrganizationScope,
} from "./scene-entity-resolver";

interface SceneEntityDatabase {
  organization: {
    findUnique(input: {
      where: { orgId: string };
      select: { id: true; orgId: true };
    }): Promise<SceneOrganizationScope | null>;
  };
  careResource: {
    findMany(input: {
      where: { organizationId: string; id: { in: readonly string[] } };
      select: { id: true; name: true; resourceType: true; isActive: true };
    }): Promise<
      Array<{
        id: string;
        name: string;
        resourceType: string;
        isActive: boolean;
      }>
    >;
  };
  rentableUnit: {
    findMany(input: {
      where: {
        storefront: { organizationId: string };
        id: { in: readonly string[] };
      };
      select: { id: true; label: true; status: true };
    }): Promise<Array<{ id: string; label: string; status: string }>>;
  };
  customerSite: {
    findMany(input: {
      where: { id: { in: readonly string[] } };
      select: { id: true; name: true; siteType: true; status: true };
    }): Promise<
      Array<{ id: string; name: string; siteType: string; status: string }>
    >;
  };
  customerConfigurationItem: {
    findMany(input: {
      where: { id: { in: readonly string[] } };
      select: { id: true; name: true; ciType: true; status: true };
    }): Promise<
      Array<{ id: string; name: string; ciType: string; status: string }>
    >;
  };
  hospitalityResource: {
    findMany(input: {
      where: {
        organizationId: string;
        kind: "table";
        id: { in: readonly string[] };
      };
      select: { id: true; label: true; kind: true; status: true };
    }): Promise<
      Array<{ id: string; label: string; kind: string; status: string }>
    >;
  };
}

type KindLoader = (
  database: SceneEntityDatabase,
  input: SceneEntityLookupInput,
) => Promise<readonly SceneEntityRecord[]>;

const INACTIVE_STATUSES = new Set([
  "inactive",
  "archived",
  "retired",
  "superseded",
  "closed",
]);

function statusIsActive(status: string): boolean {
  return !INACTIVE_STATUSES.has(status.toLowerCase());
}

const KIND_LOADERS = {
  "care-resource": async (database, { ids, organization }) => {
    const rows = await database.careResource.findMany({
      where: { organizationId: organization.id, id: { in: ids } },
      select: {
        id: true,
        name: true,
        resourceType: true,
        isActive: true,
      },
    });
    return rows.map((row) => ({
      entityKind: "care-resource",
      id: row.id,
      label: row.name,
      operationalStatus: row.isActive ? "active" : "inactive",
      active: row.isActive,
      entityType: row.resourceType,
    }));
  },
  "rentable-unit": async (database, { ids, organization }) => {
    const rows = await database.rentableUnit.findMany({
      where: {
        storefront: { organizationId: organization.id },
        id: { in: ids },
      },
      select: { id: true, label: true, status: true },
    });
    return rows.map((row) => ({
      entityKind: "rentable-unit",
      id: row.id,
      label: row.label,
      operationalStatus: row.status,
      active: statusIsActive(row.status),
    }));
  },
  "customer-site": async (database, { ids }) => {
    // CustomerAccount/CustomerSite are install-local today and do not yet carry
    // Organization ownership. The caller's layout is still organization-bound;
    // this read returns only explicitly requested IDs and selected display state.
    const rows = await database.customerSite.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, siteType: true, status: true },
    });
    return rows.map((row) => ({
      entityKind: "customer-site",
      id: row.id,
      label: row.name,
      operationalStatus: row.status,
      active: statusIsActive(row.status),
      entityType: row.siteType,
    }));
  },
  "infra-ci": async (database, { ids }) => {
    // Configuration items share the install-local CustomerAccount ownership
    // boundary described above; no synthetic org field is copied into geometry.
    const rows = await database.customerConfigurationItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, ciType: true, status: true },
    });
    return rows.map((row) => ({
      entityKind: "infra-ci",
      id: row.id,
      label: row.name,
      operationalStatus: row.status,
      active: statusIsActive(row.status),
      entityType: row.ciType,
    }));
  },
  table: async (database, { ids, organization }) => {
    const rows = await database.hospitalityResource.findMany({
      where: {
        organizationId: organization.id,
        kind: "table",
        id: { in: ids },
      },
      select: { id: true, label: true, kind: true, status: true },
    });
    return rows.map((row) => ({
      entityKind: "table",
      id: row.id,
      label: row.label,
      operationalStatus: row.status,
      active: statusIsActive(row.status),
      entityType: row.kind,
    }));
  },
} satisfies Record<OperationalSceneEntityKind, KindLoader>;

export function createPrismaSceneEntityLookup(
  database: SceneEntityDatabase,
): SceneEntityLookup {
  return {
    resolveOrganization(orgId) {
      return database.organization.findUnique({
        where: { orgId },
        select: { id: true, orgId: true },
      });
    },
    findMany(input) {
      return KIND_LOADERS[input.kind](database, input);
    },
  };
}

/**
 * Keep the Prisma singleton behind an async server boundary so the pure lookup
 * adapter remains testable without initializing the database package.
 */
export async function getPrismaSceneEntityLookup(): Promise<SceneEntityLookup> {
  const { prisma } = await import("@dpf/db");
  return createPrismaSceneEntityLookup(
    prisma as unknown as SceneEntityDatabase,
  );
}
