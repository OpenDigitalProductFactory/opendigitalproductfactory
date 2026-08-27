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
import type { TrustAssessment } from "@/lib/trust-vector";
import { buildAssuranceSummaryTrust } from "@/lib/trust-vector/adapters/assurance";

export interface BomSummary {
  state: "missing" | "current" | "stale";
  document: null | {
    documentId: string;
    digest: string;
    generatedAt: Date;
    componentCount: number;
    sourceKind: string;
  };
  latestAssuranceRunCompletedAt?: Date | null;
  counts: {
    components: number;
    models: number;
  };
  findings: AssuranceFindingSummary;
  scanner: AssuranceScannerReadiness;
  trust?: TrustAssessment;
}

export interface ProductCompositionComponentRow {
  name: string;
  version: string | null;
  componentType: string;
  ecosystem: string | null;
  packageUrl: string | null;
  lifecycleMilestones: Array<{
    milestone: string;
    date: Date | null;
    confidence: number | null;
  }>;
}

export interface ProductCompositionBomRows {
  latestBom: null | {
    documentId: string;
    generatedAt: Date;
    digest: string;
    componentCount: number;
  };
  components: ProductCompositionComponentRow[];
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
    component: Omit<ProductCompositionComponentRow, "lifecycleMilestones"> & {
      catalogIdentity?: null | {
        lifecycleMilestones?: ProductCompositionComponentRow["lifecycleMilestones"];
      };
    };
  }>;
};

type BomReadDb = {
  bomDocument: {
    findFirst(args: unknown): Promise<null | BomSummaryRow>;
  };
  assuranceRun?: {
    findFirst(args: unknown): Promise<null | { completedAt: Date | null }>;
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

type BomReadOptions = {
  now?: Date;
};

type ProductBomReadDb = {
  bomDocument: {
    findFirst(args: unknown): Promise<null | ProductBomRows>;
  };
  assuranceFinding?: BomReadDb["assuranceFinding"];
  toolEvaluation?: BomReadDb["toolEvaluation"];
};

export function missingBomSummary(options: BomReadOptions & {
  latestAssuranceRunCompletedAt?: Date | null;
} = {}): BomSummary {
  const summary: BomSummary = {
    state: "missing",
    document: null,
    latestAssuranceRunCompletedAt: options.latestAssuranceRunCompletedAt ?? null,
    counts: { components: 0, models: 0 },
    findings: emptyFindingSummary(),
    scanner: noApprovedScannerReadiness(),
  };
  return {
    ...summary,
    trust: buildAssuranceSummaryTrust(summary, { asOf: options.now }),
  };
}

function summarizeBomDocument(
  document: BomSummaryRow | null,
  findings: AssuranceFindingSummary,
  scanner: AssuranceScannerReadiness,
  latestAssuranceRunCompletedAt: Date | null,
  options: BomReadOptions = {},
): BomSummary {
  if (!document) {
    const summary: BomSummary = {
      state: "missing",
      document: null,
      latestAssuranceRunCompletedAt,
      counts: { components: 0, models: 0 },
      findings,
      scanner,
    };
    return {
      ...summary,
      trust: buildAssuranceSummaryTrust(summary, { asOf: options.now }),
    };
  }

  const modelCount = (document.occurrences ?? []).filter((entry) => (
    entry.component?.componentType === "model"
  )).length;

  const summary: BomSummary = {
    state: document.status && document.status !== "current" ? "stale" : "current",
    document: {
      documentId: document.documentId,
      digest: document.digest,
      generatedAt: document.generatedAt,
      componentCount: document.componentCount,
      sourceKind: document.sourceKind,
    },
    latestAssuranceRunCompletedAt,
    counts: {
      components: document.componentCount,
      models: modelCount,
    },
    findings,
    scanner,
  };

  return {
    ...summary,
    trust: buildAssuranceSummaryTrust(summary, { asOf: options.now }),
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
  options: BomReadOptions = {},
): Promise<BomSummary> {
  const [document, findings, scanner, latestRun] = await Promise.all([
    db.bomDocument.findFirst({
      where: { buildId },
      orderBy: { generatedAt: "desc" },
      select: latestBomSummarySelect(),
    }),
    getActiveFindingSummaryForBuild(db, buildId),
    getAssuranceScannerReadiness(db),
    getLatestAssuranceRun(db, { buildId }),
  ]);

  return summarizeBomDocument(document, findings, scanner, latestRun?.completedAt ?? null, options);
}

export async function getLatestBomSummaryForProduct(
  db: BomReadDb,
  digitalProductId: string,
  options: BomReadOptions = {},
): Promise<BomSummary> {
  const [document, findings, scanner, latestRun] = await Promise.all([
    db.bomDocument.findFirst({
      where: { digitalProductId },
      orderBy: { generatedAt: "desc" },
      select: latestBomSummarySelect(),
    }),
    getActiveFindingSummaryForProduct(db, digitalProductId),
    getAssuranceScannerReadiness(db),
    getLatestAssuranceRun(db, { digitalProductId }),
  ]);

  return summarizeBomDocument(document, findings, scanner, latestRun?.completedAt ?? null, options);
}

export async function getLatestBomComponentsForProduct(
  db: ProductBomReadDb,
  digitalProductId: string,
  limit = 200,
): Promise<ProductCompositionBomRows> {
  const [document, findingSummary, scanner] = await Promise.all([
    db.bomDocument.findFirst({
      where: { digitalProductId, status: "current" },
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
                catalogIdentity: {
                  select: {
                    lifecycleMilestones: {
                      select: { milestone: true, date: true, confidence: true },
                    },
                  },
                },
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
    components: (document.occurrences ?? []).map((occurrence) => ({
      name: occurrence.component.name,
      version: occurrence.component.version,
      componentType: occurrence.component.componentType,
      ecosystem: occurrence.component.ecosystem,
      packageUrl: occurrence.component.packageUrl,
      lifecycleMilestones: occurrence.component.catalogIdentity?.lifecycleMilestones ?? [],
    })),
    findingSummary,
    scanner,
  };
}

function getLatestAssuranceRun(
  db: BomReadDb,
  where: { buildId?: string; digitalProductId?: string },
): Promise<null | { completedAt: Date | null }> {
  if (!db.assuranceRun) return Promise.resolve(null);

  return db.assuranceRun.findFirst({
    where: {
      ...where,
      status: "completed",
    },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
}
