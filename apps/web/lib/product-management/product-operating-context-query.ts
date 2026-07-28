import { prisma } from "@dpf/db";
import {
  assembleProductOperatingContext,
  collectProductLineSubtreeIds,
  createContextSlice,
  type BusinessProductContextItem,
  type ConsumerEvidenceContextItem,
  type EnablingDigitalProductContextItem,
  type IntelligenceContextItem,
  type ProductOperatingContext,
  type ProductOperatingScope,
  type ProductSoldContextItem,
} from "./product-operating-context";

type QueryDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type OptionalQueryDelegate<T> = QueryDelegate<T> & {
  findFirst(args: unknown): Promise<T | null>;
};

type OrganizationRow = { id: string; name: string; updatedAt: Date };
type ProductLineRow = {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: Date;
};
type ProductRow = {
  id: string;
  productId: string;
  productLineId: string;
  name: string;
  updatedAt: Date;
};
type DigitalProductRow = {
  id: string;
  productId: string;
  name: string;
  updatedAt: Date;
};
type OfferingRow = {
  id: string;
  productId: string;
  providerOrganizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
  catalogItems: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: Date;
  }>;
  operationalServiceOffering: {
    digitalProduct: DigitalProductRow;
  } | null;
};
type NumberLike = number | { toNumber(): number };
type ProductSoldRow = {
  id: string;
  productId: string;
  status: string;
  quantity: NumberLike;
  totalAmount: NumberLike;
  currency: string;
  purchasedAt: Date;
  parties: Array<{
    id: string;
    role: string;
    observedAt: Date;
    displaySnapshot: unknown;
  }>;
  evidence: Array<{
    id: string;
    evidenceKind: string;
    observedAt: Date;
    evidenceSnapshot: unknown;
  }>;
  componentAllocations: Array<{
    componentCatalogItemId: string;
    allocatedAmount: NumberLike | null;
    allocationMode: string;
  }>;
};
type ResearchProposalRow = {
  proposalId: string;
  digitalProductId: string | null;
  topic: string;
  status: string;
  updatedAt: Date;
};
type BattlecardRow = {
  battlecardId: string;
  digitalProductId: string | null;
  competitorName: string;
  status: string;
  updatedAt: Date;
};
type KnowledgeArticleRow = {
  articleId: string;
  title: string;
  status: string;
  updatedAt: Date;
  products: Array<{ digitalProductId: string }>;
};
type BacklogRow = {
  itemId: string;
  title: string;
  status: string;
  demandStage: string | null;
  demandScore: number | null;
  updatedAt: Date;
  epic: { epicId: string; title: string; status: string; updatedAt: Date } | null;
};
type ChangeRow = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
};
type EaElementRow = {
  id: string;
  name: string;
  lifecycleStatus: string | null;
  updatedAt: Date;
};
type DependencyRow = {
  id: string;
  relationType: string;
  createdAt: Date;
  fromProduct: { name: string };
  toProduct: { name: string };
};

export type ProductOperatingContextQueryClient = {
  organization: {
    findFirst(args: unknown): Promise<OrganizationRow | null>;
  };
  productLine: OptionalQueryDelegate<ProductLineRow>;
  product: OptionalQueryDelegate<ProductRow>;
  productOffering: QueryDelegate<OfferingRow>;
  productSold: QueryDelegate<ProductSoldRow>;
  researchProposal: QueryDelegate<ResearchProposalRow>;
  marketingBattlecard: QueryDelegate<BattlecardRow>;
  knowledgeArticle: QueryDelegate<KnowledgeArticleRow>;
  backlogItem: QueryDelegate<BacklogRow>;
  changeItem: QueryDelegate<ChangeRow>;
  eaElement: QueryDelegate<EaElementRow>;
  productDependency: QueryDelegate<DependencyRow>;
};

export class ProductOperatingContextNotFoundError extends Error {
  constructor(scope: ProductOperatingScope) {
    super(`No ${scope.kind} ${scope.id} exists in the authorized organization`);
    this.name = "ProductOperatingContextNotFoundError";
  }
}

function numberOf(value: NumberLike | null): number {
  if (value == null) return 0;
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

function productSoldConsumers(row: ProductSoldRow): ConsumerEvidenceContextItem[] {
  const fromParties = row.parties.flatMap((party) => {
    if (
      party.role !== "account" &&
      party.role !== "consumer" &&
      party.role !== "subscriber"
    ) {
      return [];
    }
    const snapshot = recordOf(party.displaySnapshot);
    const label =
      stringOf(snapshot["name"]) ??
      stringOf(snapshot["email"]) ??
      stringOf(snapshot["accountId"]);
    if (!label) return [];
    return [
      {
        id: party.id,
        sourceKind: "product-sold-party",
        asOf: party.observedAt,
        role: party.role,
        label,
        canonicalLinkEstablished: true,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
  if (fromParties.length > 0) return fromParties;

  return row.evidence.flatMap((evidence) => {
    const snapshot = recordOf(evidence.evidenceSnapshot);
    const label =
      stringOf(snapshot["customerName"]) ??
      stringOf(snapshot["customerEmail"]);
    if (!label) return [];
    return [
      {
        id: evidence.id,
        sourceKind: evidence.evidenceKind,
        asOf: evidence.observedAt,
        role: "consumer",
        label,
        canonicalLinkEstablished: false,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
}

async function resolveBusinessScope(input: {
  db: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
}) {
  const [organization, productLines] = await Promise.all([
    input.db.organization.findFirst({
      where: { id: input.organizationId },
      select: { id: true, name: true, updatedAt: true },
    }),
    input.db.productLine.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!organization) throw new ProductOperatingContextNotFoundError(input.scope);

  let products: ProductRow[];
  let selectedProductLine: ProductLineRow | null = null;
  if (input.scope.kind === "product") {
    const product = await input.db.product.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
    if (!product) throw new ProductOperatingContextNotFoundError(input.scope);
    products = [product];
    selectedProductLine =
      productLines.find((line) => line.id === product.productLineId) ?? null;
    if (!selectedProductLine) {
      selectedProductLine = await input.db.productLine.findFirst({
        where: {
          id: product.productLineId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          updatedAt: true,
        },
      });
    }
  } else if (input.scope.kind === "product-line") {
    selectedProductLine = await input.db.productLine.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    });
    if (!selectedProductLine) {
      throw new ProductOperatingContextNotFoundError(input.scope);
    }
    products = await input.db.product.findMany({
      where: {
        organizationId: input.organizationId,
        productLineId: {
          in: collectProductLineSubtreeIds(productLines, input.scope.id),
        },
        effectiveTo: null,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  } else {
    products = await input.db.product.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  }
  return { organization, productLines, selectedProductLine, products };
}

function productScopeRows(rows: ProductRow[]): BusinessProductContextItem[] {
  return rows.map((product) => ({
    id: product.id,
    productId: product.productId,
    productLineId: product.productLineId,
    name: product.name,
    sourceKind: "product",
    asOf: product.updatedAt,
  }));
}

export async function loadProductOperatingContext(input: {
  db?: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
  authorize: (scope: { organizationId: string }) => Promise<void>;
  requestedAt?: Date;
}): Promise<ProductOperatingContext> {
  const db =
    input.db ??
    (prisma as unknown as ProductOperatingContextQueryClient);
  const requestedAt = input.requestedAt ?? new Date();

  // Authorization is deliberately resolved once at the boundary. Every query
  // still carries the organization predicate as defense in depth.
  await input.authorize({ organizationId: input.organizationId });
  const identity = await resolveBusinessScope({
    db,
    organizationId: input.organizationId,
    scope: input.scope,
  });
  const productIds = identity.products.map((product) => product.id);

  const [offerings, soldRows] = await Promise.all([
    db.productOffering.findMany({
      where: {
        organizationId: input.organizationId,
        productId: { in: productIds },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        productId: true,
        providerOrganizationId: true,
        name: true,
        status: true,
        updatedAt: true,
        catalogItems: {
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            name: true,
            status: true,
            updatedAt: true,
          },
        },
        operationalServiceOffering: {
          select: {
            digitalProduct: {
              select: {
                id: true,
                productId: true,
                name: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    }),
    db.productSold.findMany({
      where: {
        organizationId: input.organizationId,
        productId: { in: productIds },
      },
      orderBy: [{ purchasedAt: "desc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        status: true,
        quantity: true,
        totalAmount: true,
        currency: true,
        purchasedAt: true,
        parties: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            observedAt: true,
            displaySnapshot: true,
          },
        },
        evidence: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            evidenceKind: true,
            observedAt: true,
            evidenceSnapshot: true,
          },
        },
        componentAllocations: {
          orderBy: { componentCatalogItemId: "asc" },
          select: {
            componentCatalogItemId: true,
            allocatedAmount: true,
            allocationMode: true,
          },
        },
      },
    }),
  ]);

  const enablingById = new Map<string, DigitalProductRow>();
  for (const offering of offerings) {
    const digitalProduct =
      offering.operationalServiceOffering?.digitalProduct ?? null;
    if (digitalProduct) enablingById.set(digitalProduct.id, digitalProduct);
  }
  const enablingDigitalProducts = [...enablingById.values()];
  const digitalProductIds = enablingDigitalProducts.map((product) => product.id);

  const [
    research,
    battlecards,
    knowledge,
    demand,
    changes,
    elements,
    dependencies,
  ] = await Promise.all([
    db.researchProposal.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [
          { digitalProductId: null },
          ...(digitalProductIds.length > 0
            ? [{ digitalProductId: { in: digitalProductIds } }]
            : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { proposalId: "asc" }],
      take: 50,
      select: {
        proposalId: true,
        digitalProductId: true,
        topic: true,
        status: true,
        updatedAt: true,
      },
    }),
    db.marketingBattlecard.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [
          { digitalProductId: null },
          ...(digitalProductIds.length > 0
            ? [{ digitalProductId: { in: digitalProductIds } }]
            : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { battlecardId: "asc" }],
      take: 50,
      select: {
        battlecardId: true,
        digitalProductId: true,
        competitorName: true,
        status: true,
        updatedAt: true,
      },
    }),
    digitalProductIds.length > 0
      ? db.knowledgeArticle.findMany({
          where: {
            products: {
              some: { digitalProductId: { in: digitalProductIds } },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { articleId: "asc" }],
          take: 50,
          select: {
            articleId: true,
            title: true,
            status: true,
            updatedAt: true,
            products: {
              where: { digitalProductId: { in: digitalProductIds } },
              select: { digitalProductId: true },
            },
          },
        })
      : Promise.resolve([]),
    digitalProductIds.length > 0
      ? db.backlogItem.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { itemId: "asc" }],
          take: 100,
          select: {
            itemId: true,
            title: true,
            status: true,
            demandStage: true,
            demandScore: true,
            updatedAt: true,
            epic: {
              select: {
                epicId: true,
                title: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    digitalProductIds.length > 0
      ? db.changeItem.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    digitalProductIds.length > 0
      ? db.eaElement.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            name: true,
            lifecycleStatus: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    digitalProductIds.length > 0
      ? db.productDependency.findMany({
          where: {
            OR: [
              { fromProductId: { in: digitalProductIds } },
              { toProductId: { in: digitalProductIds } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            relationType: true,
            createdAt: true,
            fromProduct: { select: { name: true } },
            toProduct: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const intelligenceItems: IntelligenceContextItem[] = [
    ...research.map((row) => ({
      id: row.proposalId,
      sourceKind: "research-proposal",
      asOf: row.updatedAt,
      title: row.topic,
      scope:
        row.digitalProductId === null
          ? ("organization" as const)
          : ("digital-product" as const),
      digitalProductId: row.digitalProductId,
      status: row.status,
    })),
    ...battlecards.map((row) => ({
      id: row.battlecardId,
      sourceKind: "marketing-battlecard",
      asOf: row.updatedAt,
      title: row.competitorName,
      scope:
        row.digitalProductId === null
          ? ("organization" as const)
          : ("digital-product" as const),
      digitalProductId: row.digitalProductId,
      status: row.status,
    })),
    ...knowledge.flatMap((row) =>
      row.products.map((link) => ({
        id: row.articleId,
        sourceKind: "knowledge-article",
        asOf: row.updatedAt,
        title: row.title,
        scope: "digital-product" as const,
        digitalProductId: link.digitalProductId,
        status: row.status,
      })),
    ),
  ];

  const sold: ProductSoldContextItem[] = soldRows.map((row) => ({
    id: row.id,
    sourceKind: "product-sold",
    asOf: row.purchasedAt,
    productId: row.productId,
    status: row.status,
    quantity: numberOf(row.quantity),
    totalAmount: numberOf(row.totalAmount),
    currency: row.currency,
    consumerEvidence: productSoldConsumers(row),
    componentAllocations: row.componentAllocations.map((allocation) => ({
      catalogItemId: allocation.componentCatalogItemId,
      allocatedAmount:
        allocation.allocatedAmount === null
          ? null
          : numberOf(allocation.allocatedAmount),
      allocationMode: allocation.allocationMode,
    })),
  }));

  const roadmapById = new Map<
    string,
    { id: string; sourceKind: string; asOf: Date; title: string; status: string }
  >();
  for (const row of demand) {
    if (row.epic) {
      roadmapById.set(row.epic.epicId, {
        id: row.epic.epicId,
        sourceKind: "epic",
        asOf: row.epic.updatedAt,
        title: row.epic.title,
        status: row.epic.status,
      });
    }
  }

  const architectureItems = [
    ...elements.map((row) => ({
      id: row.id,
      sourceKind: "ea-element",
      asOf: row.updatedAt,
      title: row.name,
      status: row.lifecycleStatus ?? "unknown",
    })),
    ...dependencies.map((row) => ({
      id: row.id,
      sourceKind: "product-dependency",
      asOf: row.createdAt,
      title: `${row.fromProduct.name} ${row.relationType} ${row.toProduct.name}`,
      status: "active",
    })),
  ];

  return assembleProductOperatingContext({
    requestedAt,
    scope: input.scope,
    organization: {
      id: identity.organization.id,
      sourceKind: "organization",
      asOf: identity.organization.updatedAt,
      name: identity.organization.name,
    },
    productLines: identity.productLines.map((line) => ({
      id: line.id,
      sourceKind: "product-line",
      asOf: line.updatedAt,
      name: line.name,
      parentId: line.parentId,
    })),
    productLine: identity.selectedProductLine
      ? {
          id: identity.selectedProductLine.id,
          sourceKind: "product-line",
          asOf: identity.selectedProductLine.updatedAt,
          name: identity.selectedProductLine.name,
          parentId: identity.selectedProductLine.parentId,
        }
      : null,
    products: productScopeRows(identity.products),
    enablingDigitalProducts: createContextSlice({
      requestedAt,
      sourceKind: "operational-service-offering",
      items: enablingDigitalProducts.map(
        (product): EnablingDigitalProductContextItem => ({
          id: product.id,
          sourceKind: "digital-product",
          asOf: product.updatedAt,
          productId: product.productId,
          name: product.name,
        }),
      ),
      unavailableReason:
        productIds.length > 0 && enablingDigitalProducts.length === 0
          ? "No explicit operational offering links this business product scope to a DigitalProduct."
          : undefined,
    }),
    offerings: createContextSlice({
      requestedAt,
      sourceKind: "product-offering",
      items: offerings.map((offering) => ({
        id: offering.id,
        sourceKind: "product-offering",
        asOf: offering.updatedAt,
        productId: offering.productId,
        providerOrganizationId: offering.providerOrganizationId,
        name: offering.name,
        status: offering.status,
      })),
    }),
    catalogItems: createContextSlice({
      requestedAt,
      sourceKind: "catalog-item",
      items: offerings.flatMap((offering) =>
        offering.catalogItems.map((catalogItem) => ({
          id: catalogItem.id,
          sourceKind: "catalog-item",
          asOf: catalogItem.updatedAt,
          productId: offering.productId,
          name: catalogItem.name,
          status: catalogItem.status,
        })),
      ),
    }),
    productSold: createContextSlice({
      requestedAt,
      sourceKind: "product-sold",
      items: sold,
    }),
    intelligence: createContextSlice({
      requestedAt,
      sourceKind: "research-battlecard-knowledge",
      items: intelligenceItems,
    }),
    demand: createContextSlice({
      requestedAt,
      sourceKind: "backlog-item",
      items: demand.map((row) => ({
        id: row.itemId,
        sourceKind: "backlog-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
        demandStage: row.demandStage,
        score: row.demandScore,
      })),
    }),
    decisions: createContextSlice({
      requestedAt,
      sourceKind: "decision-interaction",
      items: [],
      unavailableReason:
        "No typed business-product decision association exists yet.",
    }),
    objectives: createContextSlice({
      requestedAt,
      sourceKind: "product-objective",
      items: [],
      unavailableReason:
        "The product objective and outcome contract is introduced in Phase 9.",
    }),
    roadmapInputs: createContextSlice({
      requestedAt,
      sourceKind: "epic",
      items: [...roadmapById.values()],
    }),
    deliveryChanges: createContextSlice({
      requestedAt,
      sourceKind: "change-item",
      items: changes.map((row) => ({
        id: row.id,
        sourceKind: "change-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
      })),
    }),
    architecture: createContextSlice({
      requestedAt,
      sourceKind: "ea-element-and-product-dependency",
      items: architectureItems,
    }),
    scheduledPlaybooks: createContextSlice({
      requestedAt,
      sourceKind: "scheduled-agent-task",
      items: [],
      unavailableReason:
        "ScheduledAgentTask has no typed organization or product association; prompt and route text are not inferred.",
    }),
  });
}
