type ProductSoldQueryClient = {
  productSold: {
    findMany(input: unknown): Promise<ProductSoldQueryRow[]>;
  };
};

type NumberLike = number | { toNumber(): number };

type ProductSoldQueryRow = {
  id: string;
  productSoldId: string;
  status: string;
  quantity: NumberLike;
  totalAmount: NumberLike;
  currency: string;
  purchasedAt: Date;
  commercialSnapshot: unknown;
  pricingSnapshot: unknown;
  evidence: Array<{
    evidenceId: string;
    evidenceKind: string;
    observedAt: Date;
    evidenceSnapshot: unknown;
    sourceRef: string | null;
  }>;
  parties: Array<{
    role: string;
    displaySnapshot: unknown;
  }>;
  entitlements: Array<{
    entitlementId: string;
    entitlementKind: string;
    status: string;
    rightSnapshot: unknown;
    validFrom: Date;
    validTo: Date | null;
  }>;
  fulfillmentInstances: Array<{
    instanceId: string;
    instanceKind: string;
    status: string;
    fulfillmentSnapshot: unknown;
  }>;
  componentAllocations: Array<{
    componentCatalogItemId: string;
    allocatedAmount: NumberLike | null;
    allocationPercent: NumberLike | null;
    reportingTreatment: string;
    componentSnapshot: unknown;
  }>;
};

function numberOf(value: NumberLike | null): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function customerProjection(row: ProductSoldQueryRow) {
  if (row.parties.length > 0) {
    const roles = [...new Set(row.parties.map((party) => party.role))].sort();
    const account = row.parties.find((party) => party.role === "account");
    const consumer = row.parties.find((party) => party.role === "consumer");
    const subscriber = row.parties.find((party) => party.role === "subscriber");
    const accountSnapshot = recordOf(account?.displaySnapshot);
    const consumerSnapshot = recordOf(consumer?.displaySnapshot);
    const subscriberSnapshot = recordOf(subscriber?.displaySnapshot);
    return {
      label:
        stringOf(accountSnapshot["name"]) ??
        stringOf(consumerSnapshot["name"]) ??
        stringOf(subscriberSnapshot["name"]) ??
        stringOf(consumerSnapshot["email"]) ??
        stringOf(subscriberSnapshot["email"]) ??
        "Linked customer",
      email:
        stringOf(consumerSnapshot["email"]) ??
        stringOf(subscriberSnapshot["email"]),
      canonicalLinkEstablished: true,
      roles,
    };
  }

  for (const evidence of row.evidence) {
    const snapshot = recordOf(evidence.evidenceSnapshot);
    const email = stringOf(snapshot["customerEmail"]);
    const name = stringOf(snapshot["customerName"]);
    if (email || name) {
      return {
        label: name ?? email ?? "Customer evidence captured",
        email,
        canonicalLinkEstablished: false,
        roles: [] as string[],
      };
    }
  }
  return {
    label: "Customer not linked",
    email: null,
    canonicalLinkEstablished: false,
    roles: [] as string[],
  };
}

function commercialProjection(snapshotValue: unknown) {
  const snapshot = recordOf(snapshotValue);
  const product = recordOf(snapshot["product"]);
  const offering = recordOf(snapshot["offering"]);
  const catalogItem = recordOf(snapshot["catalogItem"]);
  const catalogSku = recordOf(snapshot["catalogSku"]);
  const configuration = recordOf(snapshot["configuration"]);
  return {
    providerOrganizationId:
      stringOf(snapshot["providerOrganizationId"]) ?? null,
    product: {
      productId: stringOf(product["productId"]),
      name: stringOf(product["name"]) ?? "Product",
    },
    offering: {
      offeringId: stringOf(offering["offeringId"]),
      name: stringOf(offering["name"]) ?? "Offering",
    },
    catalogItem: {
      catalogItemId: stringOf(catalogItem["catalogItemId"]),
      name: stringOf(catalogItem["name"]) ?? "Purchase",
    },
    catalogSku:
      Object.keys(catalogSku).length > 0
        ? {
            skuId: stringOf(catalogSku["skuId"]),
            code: stringOf(catalogSku["code"]),
            name: stringOf(catalogSku["name"]),
          }
        : null,
    configuration:
      Object.keys(configuration).length > 0
        ? {
            configurationId: stringOf(configuration["configurationId"]),
            name: stringOf(configuration["name"]),
          }
        : null,
  };
}

export async function getCatalogItemProductSoldTrace(input: {
  db: ProductSoldQueryClient;
  organizationId: string;
  catalogItemId: string;
}) {
  const rows = await input.db.productSold.findMany({
    where: {
      organizationId: input.organizationId,
      catalogItemId: input.catalogItemId,
    },
    orderBy: [{ purchasedAt: "desc" }, { productSoldId: "asc" }],
    include: {
      evidence: { orderBy: [{ observedAt: "asc" }, { evidenceId: "asc" }] },
      parties: { orderBy: [{ role: "asc" }, { partyId: "asc" }] },
      entitlements: {
        orderBy: [{ validFrom: "asc" }, { entitlementId: "asc" }],
      },
      fulfillmentInstances: {
        orderBy: [{ createdAt: "asc" }, { instanceId: "asc" }],
      },
      componentAllocations: { orderBy: { allocationId: "asc" } },
    },
  });

  const currencies = new Set(rows.map((row) => row.currency));
  return {
    saleCount: rows.length,
    additiveRevenue: rows.reduce(
      (sum, row) => sum + (numberOf(row.totalAmount) ?? 0),
      0,
    ),
    currency: currencies.size === 1 ? [...currencies][0] : null,
    records: rows.map((row) => ({
      id: row.id,
      productSoldId: row.productSoldId,
      status: row.status,
      quantity: numberOf(row.quantity) ?? 0,
      totalAmount: numberOf(row.totalAmount) ?? 0,
      currency: row.currency,
      purchasedAt: row.purchasedAt,
      commercial: commercialProjection(row.commercialSnapshot),
      pricingSnapshot: row.pricingSnapshot,
      customer: customerProjection(row),
      evidence: row.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        kind: evidence.evidenceKind,
        observedAt: evidence.observedAt,
        sourceRef: evidence.sourceRef,
      })),
      entitlements: row.entitlements,
      fulfillmentInstances: row.fulfillmentInstances,
      packageAllocations: row.componentAllocations.map((allocation) => {
        const snapshot = recordOf(allocation.componentSnapshot);
        return {
          catalogItemId:
            stringOf(snapshot["catalogItemId"]) ??
            allocation.componentCatalogItemId,
          name: stringOf(snapshot["name"]) ?? "Included item",
          allocatedAmount: numberOf(allocation.allocatedAmount),
          allocationPercent: numberOf(allocation.allocationPercent),
          additive: false as const,
        };
      }),
    })),
  };
}
