export type OperationalOfferingView = {
  id: string;
  offeringId: string;
  name: string;
  description: string | null;
  availabilityTarget: number | null;
  mttrHours: number | null;
  rtoHours: number | null;
  rpoHours: number | null;
  supportHours: string | null;
  status: string;
  commercialTrace: {
    offeringId: string;
    catalogItems: Array<{
      catalogItemId: string;
      name: string;
      status: string;
    }>;
  } | null;
};

export type OperationalOfferingClient = {
  digitalProduct: {
    findUnique: (
      args: Record<string, unknown>,
    ) => Promise<{ id: string } | null>;
  };
  serviceOffering: {
    findMany: (
      args: Record<string, unknown>,
    ) => Promise<
      Array<
        Omit<OperationalOfferingView, "commercialTrace"> & {
          commercialOffering: OperationalOfferingView["commercialTrace"];
        }
      >
    >;
  };
};

/**
 * Query boundary for the DigitalProduct operational-offering workspace.
 * Commercial data is disclosed only through an explicit ServiceOffering link;
 * no business product, offering, or catalog relationship is inferred here.
 */
export async function loadDigitalProductOperationalOfferings(
  db: OperationalOfferingClient,
  digitalProductId: string,
): Promise<{ exists: boolean; offerings: OperationalOfferingView[] }> {
  const product = await db.digitalProduct.findUnique({
    where: { id: digitalProductId },
    select: { id: true },
  });
  if (!product) return { exists: false, offerings: [] };

  const rows = await db.serviceOffering.findMany({
    where: { digitalProductId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      offeringId: true,
      name: true,
      description: true,
      availabilityTarget: true,
      mttrHours: true,
      rtoHours: true,
      rpoHours: true,
      supportHours: true,
      status: true,
      commercialOffering: {
        select: {
          offeringId: true,
          catalogItems: {
            orderBy: { name: "asc" },
            select: {
              catalogItemId: true,
              name: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const offerings = rows.map(({ commercialOffering, ...offering }) => ({
    ...offering,
    commercialTrace: commercialOffering,
  }));

  return { exists: true, offerings };
}
