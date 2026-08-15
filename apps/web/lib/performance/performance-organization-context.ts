export type PerformanceOrganizationContext =
  | {
      status: "resolved";
      organizationId: string;
      archetypeId: string;
    }
  | {
      status: "unconfigured";
      reason: string;
    };

type StorefrontContext = {
  organizationId: string;
  archetype: { archetypeId: string };
};

export interface PerformanceOrganizationContextDataSource {
  platformSetupProgress: {
    findUnique(args: unknown): Promise<{ organizationId: string | null } | null>;
  };
  storefrontConfig: {
    findUnique(args: unknown): Promise<StorefrontContext | null>;
    findMany(args: unknown): Promise<StorefrontContext[]>;
  };
}

export async function resolvePerformanceOrganizationContext(
  db: PerformanceOrganizationContextDataSource,
  userId: string,
): Promise<PerformanceOrganizationContext> {
  const progress = await db.platformSetupProgress.findUnique({
    where: { userId },
    select: { organizationId: true },
  });

  if (progress?.organizationId) {
    const config = await db.storefrontConfig.findUnique({
      where: { organizationId: progress.organizationId },
      select: {
        organizationId: true,
        archetype: { select: { archetypeId: true } },
      },
    });
    return config
      ? {
          status: "resolved",
          organizationId: config.organizationId,
          archetypeId: config.archetype.archetypeId,
        }
      : {
          status: "unconfigured",
          reason: "Finish storefront setup before performance is calculated.",
        };
  }

  const configs = await db.storefrontConfig.findMany({
    orderBy: { organizationId: "asc" },
    take: 2,
    select: {
      organizationId: true,
      archetype: { select: { archetypeId: true } },
    },
  });
  if (configs.length === 0) {
    return {
      status: "unconfigured",
      reason: "Finish storefront setup before performance is calculated.",
    };
  }
  if (configs.length > 1) {
    return {
      status: "unconfigured",
      reason:
        "We could not determine your current organization, so no performance data was loaded.",
    };
  }
  return {
    status: "resolved",
    organizationId: configs[0]!.organizationId,
    archetypeId: configs[0]!.archetype.archetypeId,
  };
}
