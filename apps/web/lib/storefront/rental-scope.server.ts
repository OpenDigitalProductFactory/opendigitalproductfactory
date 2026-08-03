import { prisma } from "@dpf/db";

export interface RentalStorefrontScope {
  id: string;
  organizationId: string;
  archetypeId: string;
}

export interface RentalScopeDb {
  storefrontConfig: {
    findMany(args: unknown): Promise<RentalStorefrontScope[]>;
  };
}

/**
 * Resolve the storefront authority for rental operations. DPF currently has no
 * user-to-organization membership in the auth session, so an install with more
 * than one organization must pass an explicit organization or fail closed.
 */
export async function resolveRentalStorefront(
  db: RentalScopeDb = prisma as unknown as RentalScopeDb,
  organizationId?: string,
): Promise<RentalStorefrontScope | null> {
  const configurations = await db.storefrontConfig.findMany({
    ...(organizationId ? { where: { organizationId } } : {}),
    orderBy: { organizationId: "asc" },
    take: organizationId ? 1 : 2,
    select: {
      id: true,
      organizationId: true,
      archetypeId: true,
    },
  });
  if (configurations.length === 0) return null;
  if (!organizationId && configurations.length > 1) {
    throw new Error("Rental storefront scope is ambiguous: multiple organizations are configured");
  }
  // Keep the scope boundary fail-closed even when a test double or future data
  // adapter returns a wider result set than the requested Prisma filter.
  if (organizationId) {
    return configurations.find((configuration) => configuration.organizationId === organizationId) ?? null;
  }
  return configurations[0] ?? null;
}
