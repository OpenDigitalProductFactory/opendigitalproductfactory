export interface BomSummary {
  state: "missing" | "current" | "stale";
  document: null | {
    documentId: string;
    digest: string;
    generatedAt: Date;
    componentCount: number;
    sourceKind: string;
  };
  counts: {
    components: number;
    models: number;
  };
}

export interface ProductSupplyChainComponentRow {
  name: string;
  version: string | null;
  componentType: string;
  ecosystem: string | null;
  packageUrl: string | null;
}

export interface ProductSupplyChainBomRows {
  latestBom: null | {
    documentId: string;
    generatedAt: Date;
    digest: string;
    componentCount: number;
  };
  components: ProductSupplyChainComponentRow[];
}

type BomSummaryRow = {
  documentId: string;
  digest: string;
  generatedAt: Date;
  componentCount: number;
  sourceKind: string;
  status?: string | null;
  occurrences?: Array<{ component?: { componentType?: string | null } | null }>;
};

type ProductBomRows = {
  documentId: string;
  generatedAt: Date;
  digest: string;
  componentCount: number;
  occurrences?: Array<{
    component: ProductSupplyChainComponentRow;
  }>;
};

type BomReadDb = {
  bomDocument: {
    findFirst(args: unknown): Promise<null | BomSummaryRow>;
  };
};

type ProductBomReadDb = {
  bomDocument: {
    findFirst(args: unknown): Promise<null | ProductBomRows>;
  };
};

export function missingBomSummary(): BomSummary {
  return {
    state: "missing",
    document: null,
    counts: { components: 0, models: 0 },
  };
}

function summarizeBomDocument(document: BomSummaryRow | null): BomSummary {
  if (!document) return missingBomSummary();

  const modelCount = (document.occurrences ?? []).filter((entry) => (
    entry.component?.componentType === "model"
  )).length;

  return {
    state: document.status && document.status !== "current" ? "stale" : "current",
    document: {
      documentId: document.documentId,
      digest: document.digest,
      generatedAt: document.generatedAt,
      componentCount: document.componentCount,
      sourceKind: document.sourceKind,
    },
    counts: {
      components: document.componentCount,
      models: modelCount,
    },
  };
}

function latestBomSummarySelect() {
  return {
    documentId: true,
    digest: true,
    generatedAt: true,
    componentCount: true,
    sourceKind: true,
    status: true,
    occurrences: {
      select: {
        component: {
          select: {
            componentType: true,
          },
        },
      },
    },
  };
}

export async function getLatestBomSummaryForBuild(
  db: BomReadDb,
  buildId: string,
): Promise<BomSummary> {
  const document = await db.bomDocument.findFirst({
    where: { buildId },
    orderBy: { generatedAt: "desc" },
    select: latestBomSummarySelect(),
  });

  return summarizeBomDocument(document);
}

export async function getLatestBomSummaryForProduct(
  db: BomReadDb,
  digitalProductId: string,
): Promise<BomSummary> {
  const document = await db.bomDocument.findFirst({
    where: { digitalProductId },
    orderBy: { generatedAt: "desc" },
    select: latestBomSummarySelect(),
  });

  return summarizeBomDocument(document);
}

export async function getLatestBomComponentsForProduct(
  db: ProductBomReadDb,
  digitalProductId: string,
  limit = 200,
): Promise<ProductSupplyChainBomRows> {
  const document = await db.bomDocument.findFirst({
    where: { digitalProductId },
    orderBy: { generatedAt: "desc" },
    select: {
      documentId: true,
      generatedAt: true,
      digest: true,
      componentCount: true,
      occurrences: {
        select: {
          component: {
            select: {
              name: true,
              version: true,
              componentType: true,
              ecosystem: true,
              packageUrl: true,
            },
          },
        },
        take: limit,
      },
    },
  });

  if (!document) {
    return { latestBom: null, components: [] };
  }

  return {
    latestBom: {
      documentId: document.documentId,
      generatedAt: document.generatedAt,
      digest: document.digest,
      componentCount: document.componentCount,
    },
    components: (document.occurrences ?? []).map((occurrence) => occurrence.component),
  };
}
