import {
  CAPABILITY_INSTALL_SCOPES,
  deriveConfidenceGrade,
  deriveEffectiveMaturity,
  deriveMvpTargetScore,
  type CapabilityInstallScope,
  type CapabilityMaturityCategory,
  type CapabilityMaturityConfidenceGrade,
  type CapabilityMaturityRiskTier,
  type CapabilityProductizationStatus,
} from "@dpf/db/capability-maturity";

const DEPENDENCY_INCLUDE_DEPTH = 16;

export type CapabilityMaturityAssessmentRecord = {
  id: string;
  assessmentId: string;
  name: string;
  portfolioId: string;
  taxonomyNodeId?: string | null;
  capabilityCategory: CapabilityMaturityCategory;
  riskTier: CapabilityMaturityRiskTier;
  maturityScore: number;
  confidenceGrade: CapabilityMaturityConfidenceGrade;
  installScope: CapabilityInstallScope;
  productizationStatus: CapabilityProductizationStatus;
  hasContinuousEvidence: boolean;
  evidenceFreshnessAt: Date | null;
  lastGovernanceReviewAt: Date | null;
  operationalSurface?: string | null;
  existingPrimitives?: unknown;
  maturityGaps?: unknown;
  evidenceSources?: unknown;
  hiveMindSignals?: unknown;
  kernelPrinciples?: string[];
  dependencies?: Array<{ dependency: CapabilityMaturityAssessmentRecord }>;
};

export type CapabilityMaturityLifecycleMode = "investment" | "operations";
export type CapabilityMaturityProductizationOverlay =
  | "none"
  | "eligible"
  | "candidate"
  | "productized";

export type CapabilityMaturityDependencyBlock = {
  assessmentId: string;
  name: string;
  effectiveMaturity: number;
};

export type CapabilityMaturityRow = {
  id: string;
  assessmentId: string;
  name: string;
  portfolioId: string;
  taxonomyNodeId: string | null;
  capabilityCategory: CapabilityMaturityCategory;
  riskTier: CapabilityMaturityRiskTier;
  maturityScore: number;
  mvpTargetScore: number;
  effectiveMaturity: number;
  confidenceGrade: CapabilityMaturityConfidenceGrade;
  installScope: CapabilityInstallScope;
  lifecycleMode: CapabilityMaturityLifecycleMode;
  productizationStatus: CapabilityProductizationStatus;
  productizationOverlay: CapabilityMaturityProductizationOverlay;
  gapToTarget: number;
  blockedByDependencies: CapabilityMaturityDependencyBlock[];
  operationalSurface: string | null;
  existingPrimitives: unknown;
  maturityGaps: unknown;
  evidenceSources: unknown;
  hiveMindSignals: unknown;
  kernelPrinciples: string[];
};

export type CapabilityMaturitySummary = {
  total: number;
  belowTarget: number;
  investment: number;
  operations: number;
  productizationOverlays: number;
};

export type CapabilityMaturityRollup = {
  rows: CapabilityMaturityRow[];
  summary: CapabilityMaturitySummary;
};

type CapabilityMaturityFindManyArgs = {
  where: {
    portfolioId: string;
    installScope: CapabilityInstallScope;
    taxonomyNodeId?: string;
  };
  include: Record<string, unknown>;
  orderBy: Array<Record<string, "asc" | "desc">>;
};

export type CapabilityMaturityPrisma = {
  capabilityMaturityAssessment: {
    findMany(args: CapabilityMaturityFindManyArgs): Promise<CapabilityMaturityAssessmentRecord[]>;
  };
};

export type GetCapabilityMaturityInput = {
  prisma: CapabilityMaturityPrisma;
  portfolioId: string;
  taxonomyNodeId?: string | null;
  installScope: CapabilityInstallScope;
  now?: Date;
};

function dependencyInclude(depth: number): Record<string, unknown> {
  if (depth <= 0) {
    return { include: { dependency: true } };
  }

  return {
    include: {
      dependency: {
        include: {
          dependencies: dependencyInclude(depth - 1),
        },
      },
    },
  };
}

function assertInstallScope(installScope: CapabilityInstallScope | null | undefined): CapabilityInstallScope {
  if (!installScope || !CAPABILITY_INSTALL_SCOPES.includes(installScope)) {
    throw new Error("installScope is required for capability maturity rollups.");
  }
  return installScope;
}

function productizationOverlay(
  status: CapabilityProductizationStatus,
): CapabilityMaturityProductizationOverlay {
  return status === "eligible" || status === "candidate" || status === "productized"
    ? status
    : "none";
}

function deriveRow(
  record: CapabilityMaturityAssessmentRecord,
  now: Date,
  cache: Map<string, CapabilityMaturityRow>,
): CapabilityMaturityRow {
  const cached = cache.get(record.id);
  if (cached) return cached;

  const dependencyRows = (record.dependencies ?? []).map(({ dependency }) =>
    deriveRow(dependency, now, cache),
  );
  const confidenceGrade = deriveConfidenceGrade({
    now,
    evidenceFreshnessAt: record.evidenceFreshnessAt,
    lastGovernanceReviewAt: record.lastGovernanceReviewAt,
    hasContinuousEvidence: record.hasContinuousEvidence,
  });
  const mvpTargetScore = deriveMvpTargetScore(record.riskTier);
  const effectiveMaturity = deriveEffectiveMaturity({
    maturityScore: record.maturityScore,
    dependencyEffectiveMaturities: dependencyRows.map((row) => row.effectiveMaturity),
    confidenceGrade,
  });
  const lifecycleMode = effectiveMaturity >= mvpTargetScore ? "operations" : "investment";

  const row: CapabilityMaturityRow = {
    id: record.id,
    assessmentId: record.assessmentId,
    name: record.name,
    portfolioId: record.portfolioId,
    taxonomyNodeId: record.taxonomyNodeId ?? null,
    capabilityCategory: record.capabilityCategory,
    riskTier: record.riskTier,
    maturityScore: record.maturityScore,
    mvpTargetScore,
    effectiveMaturity,
    confidenceGrade,
    installScope: record.installScope,
    lifecycleMode,
    productizationStatus: record.productizationStatus,
    productizationOverlay: productizationOverlay(record.productizationStatus),
    gapToTarget: Math.max(0, mvpTargetScore - effectiveMaturity),
    blockedByDependencies: dependencyRows
      .filter((dependency) => dependency.effectiveMaturity < record.maturityScore)
      .map((dependency) => ({
        assessmentId: dependency.assessmentId,
        name: dependency.name,
        effectiveMaturity: dependency.effectiveMaturity,
      })),
    operationalSurface: record.operationalSurface ?? null,
    existingPrimitives: record.existingPrimitives ?? [],
    maturityGaps: record.maturityGaps ?? [],
    evidenceSources: record.evidenceSources ?? [],
    hiveMindSignals: record.hiveMindSignals ?? [],
    kernelPrinciples: record.kernelPrinciples ?? [],
  };

  cache.set(record.id, row);
  return row;
}

function summarize(rows: CapabilityMaturityRow[]): CapabilityMaturitySummary {
  const investment = rows.filter((row) => row.lifecycleMode === "investment").length;
  const operations = rows.length - investment;
  const productizationOverlays = rows.filter(
    (row) => row.productizationOverlay !== "none",
  ).length;

  return {
    total: rows.length,
    belowTarget: investment,
    investment,
    operations,
    productizationOverlays,
  };
}

export async function getCapabilityMaturityForPortfolioNode(
  input: GetCapabilityMaturityInput,
): Promise<CapabilityMaturityRollup> {
  const installScope = assertInstallScope(input.installScope);
  const where: CapabilityMaturityFindManyArgs["where"] = {
    portfolioId: input.portfolioId,
    installScope,
  };
  if (input.taxonomyNodeId) {
    where.taxonomyNodeId = input.taxonomyNodeId;
  }

  const records = await input.prisma.capabilityMaturityAssessment.findMany({
    where,
    include: {
      dependencies: dependencyInclude(DEPENDENCY_INCLUDE_DEPTH),
    },
    orderBy: [{ name: "asc" }, { assessmentId: "asc" }],
  });
  const now = input.now ?? new Date();
  const cache = new Map<string, CapabilityMaturityRow>();
  const rows = records.map((record) => deriveRow(record, now, cache));

  return {
    rows,
    summary: summarize(rows),
  };
}
