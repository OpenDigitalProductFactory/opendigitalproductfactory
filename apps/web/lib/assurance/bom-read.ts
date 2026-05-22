import {
  emptyFindingSummary,
  getActiveFindingSummaryForBuild,
  getActiveFindingSummaryForProduct,
  type AssuranceFindingSummary,
} from "./finding-read";
import {
  getAssuranceScannerReadiness,
  noApprovedScannerReadiness,
  type AssuranceScannerReadiness,
} from "./scanner-catalog";

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
  findings: AssuranceFindingSummary;
  scanner: AssuranceScannerReadiness;
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
  findingSummary: AssuranceFindingSummary;
  scanner: AssuranceScannerReadiness;
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
  assuranceFinding?: {
    findMany(args: unknown): Promise<Array<{
      policySeverity: string;
      releaseImpact: string;
      status: string;
      findingKind: string;
    }>>;
  };
  toolEvaluation?: {
    findMany(args: unknown): Promise<Array<{
      toolName: string;
      toolType?: string | null;
      status: string;
      conditions?: unknown;
      verdict?: unknown;
      approvedAt?: Date | string | null;
    }>>;
  };
};

type ProductBomReadDb = {
  bomDocument: {
    findFirst(args: unknown): Promise<null | ProductBomRows>;
  };
  assuranceFinding?: BomReadDb["assuranceFinding"];
  toolEvaluation?: BomReadDb["toolEvaluation"];
};

export function missingBomSummary(): BomSummary {
  return {
    state: "missing",
    document: null,
    counts: { components: 0, models: 0 },
    findings: emptyFindingSummary(),
    scanner: noApprovedScannerReadiness(),
  };
}

function summarizeBomDocument(
  document: BomSummaryRow | null,
  findings: AssuranceFindingSummary,
  scanner: AssuranceScannerReadiness,
): BomSummary {
  if (!document) {
    return {
      ...missingBomSummary(),
      findings,
      scanner,
    };
  }

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
    findings,
    scanner,
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
  const [document, findings, scanner] = await Promise.all([
    db.bomDocument.findFirst({
      where: { buildId },
      orderBy: { generatedAt: "desc" },
      select: latestBomSummarySelect(),
    }),
    getActiveFindingSummaryForBuild(db, buildId),
    getAssuranceScannerReadiness(db),
  ]);

  return summarizeBomDocument(document, findings, scanner);
}

export async function getLatestBomSummaryForProduct(
  db: BomReadDb,
  digitalProductId: string,
): Promise<BomSummary> {
  const [document, findings, scanner] = await Promise.all([
    db.bomDocument.findFirst({
      where: { digitalProductId },
      orderBy: { generatedAt: "desc" },
      select: latestBomSummarySelect(),
    }),
    getActiveFindingSummaryForProduct(db, digitalProductId),
    getAssuranceScannerReadiness(db),
  ]);

  return summarizeBomDocument(document, findings, scanner);
}

export async function getLatestBomComponentsForProduct(
  db: ProductBomReadDb,
  digitalProductId: string,
  limit = 200,
): Promise<ProductSupplyChainBomRows> {
  const [document, findingSummary, scanner] = await Promise.all([
    db.bomDocument.findFirst({
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
    }),
    getActiveFindingSummaryForProduct(db, digitalProductId),
    getAssuranceScannerReadiness(db),
  ]);

  if (!document) {
    return { latestBom: null, components: [], findingSummary, scanner };
  }

  return {
    latestBom: {
      documentId: document.documentId,
      generatedAt: document.generatedAt,
      digest: document.digest,
      componentCount: document.componentCount,
    },
    components: (document.occurrences ?? []).map((occurrence) => occurrence.component),
    findingSummary,
    scanner,
  };
}
