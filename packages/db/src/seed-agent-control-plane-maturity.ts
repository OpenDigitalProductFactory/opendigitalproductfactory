import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "../generated/client/client";
import {
  CAPABILITY_INSTALL_SCOPES,
  CAPABILITY_MATURITY_CATEGORIES,
  CAPABILITY_MATURITY_CONFIDENCE_GRADES,
  CAPABILITY_MATURITY_RISK_TIERS,
  CAPABILITY_PRODUCTIZATION_STATUSES,
  CAPABILITY_STRATEGIC_OWNERSHIP,
  validateCapabilityDependencyGraph,
  type CapabilityInstallScope,
  type CapabilityMaturityCategory,
  type CapabilityMaturityConfidenceGrade,
  type CapabilityMaturityRiskTier,
  type CapabilityProductizationStatus,
  type CapabilityStrategicOwnership,
} from "./capability-maturity";

const DATA_DIR = join(__dirname, "..", "data");
const SEED_FILE = "agent_control_plane_maturity_seed.json";
const DEFAULT_KERNEL_PRINCIPLES_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "founder-kernel",
  "wiki",
  "principles",
);

export type VendorReplacementConfidence = "low" | "medium" | "high" | "verified";

export type AgentControlPlaneMaturitySeedRow = {
  assessmentId: string;
  name: string;
  portfolioSlug: string;
  taxonomyNodePath?: string | null;
  capabilityCategory: CapabilityMaturityCategory;
  riskTier: CapabilityMaturityRiskTier;
  maturityScore: number;
  confidenceGrade: CapabilityMaturityConfidenceGrade;
  strategicOwnership: CapabilityStrategicOwnership;
  vendorReplacementConfidence: VendorReplacementConfidence;
  installScope: CapabilityInstallScope;
  productizationStatus: CapabilityProductizationStatus;
  parityChecklistEvidence?: unknown[];
  existingPrimitives: unknown[];
  maturityGaps: unknown[];
  evidenceSources: unknown[];
  hiveMindSignals: unknown[];
  kernelPrinciples: string[];
  operationalSurface?: string | null;
  dependsOnAssessmentIds: string[];
};

export type SeedValidationOptions = {
  kernelPrinciplesDir?: string;
  kernelPrincipleSlugs?: ReadonlySet<string>;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string, assessmentId: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Seed row ${assessmentId} has invalid ${field}; expected a non-empty string.`);
  }
}

function assertStringArray(value: unknown, field: string, assessmentId: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Seed row ${assessmentId} has invalid ${field}; expected string[].`);
  }
}

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function parseSeedRow(raw: unknown): AgentControlPlaneMaturitySeedRow {
  if (!isPlainObject(raw)) {
    throw new Error("Agent control plane maturity seed row must be an object.");
  }

  const assessmentId = raw.assessmentId;
  assertString(assessmentId, "assessmentId", "unknown");
  assertString(raw.name, "name", assessmentId);
  assertString(raw.portfolioSlug, "portfolioSlug", assessmentId);

  if (raw.taxonomyNodePath !== undefined && raw.taxonomyNodePath !== null) {
    assertString(raw.taxonomyNodePath, "taxonomyNodePath", assessmentId);
  }

  if (!includesValue(CAPABILITY_MATURITY_CATEGORIES, raw.capabilityCategory)) {
    throw new Error(`Seed row ${assessmentId} has invalid capabilityCategory: ${String(raw.capabilityCategory)}`);
  }
  if (!includesValue(CAPABILITY_MATURITY_RISK_TIERS, raw.riskTier)) {
    throw new Error(`Seed row ${assessmentId} has invalid riskTier: ${String(raw.riskTier)}`);
  }
  const maturityScore = raw.maturityScore;
  if (typeof maturityScore !== "number" || !Number.isInteger(maturityScore) || maturityScore < 0 || maturityScore > 5) {
    throw new Error(`Seed row ${assessmentId} has invalid maturityScore: ${String(maturityScore)}`);
  }
  if (!includesValue(CAPABILITY_MATURITY_CONFIDENCE_GRADES, raw.confidenceGrade)) {
    throw new Error(`Seed row ${assessmentId} has invalid confidenceGrade: ${String(raw.confidenceGrade)}`);
  }
  if (!includesValue(CAPABILITY_STRATEGIC_OWNERSHIP, raw.strategicOwnership)) {
    throw new Error(`Seed row ${assessmentId} has invalid strategicOwnership: ${String(raw.strategicOwnership)}`);
  }
  if (!includesValue(["low", "medium", "high", "verified"] as const, raw.vendorReplacementConfidence)) {
    throw new Error(
      `Seed row ${assessmentId} has invalid vendorReplacementConfidence: ${String(raw.vendorReplacementConfidence)}`,
    );
  }
  if (!includesValue(CAPABILITY_INSTALL_SCOPES, raw.installScope)) {
    throw new Error(`Seed row ${assessmentId} has invalid installScope: ${String(raw.installScope)}`);
  }
  if (!includesValue(CAPABILITY_PRODUCTIZATION_STATUSES, raw.productizationStatus)) {
    throw new Error(`Seed row ${assessmentId} has invalid productizationStatus: ${String(raw.productizationStatus)}`);
  }

  const parityChecklistEvidence = raw.parityChecklistEvidence ?? [];
  if (!Array.isArray(parityChecklistEvidence)) {
    throw new Error(`Seed row ${assessmentId} has invalid parityChecklistEvidence; expected array.`);
  }
  if (!Array.isArray(raw.existingPrimitives)) {
    throw new Error(`Seed row ${assessmentId} has invalid existingPrimitives; expected array.`);
  }
  if (!Array.isArray(raw.maturityGaps)) {
    throw new Error(`Seed row ${assessmentId} has invalid maturityGaps; expected array.`);
  }
  if (!Array.isArray(raw.evidenceSources)) {
    throw new Error(`Seed row ${assessmentId} has invalid evidenceSources; expected array.`);
  }
  if (!Array.isArray(raw.hiveMindSignals)) {
    throw new Error(`Seed row ${assessmentId} has invalid hiveMindSignals; expected array.`);
  }
  assertStringArray(raw.kernelPrinciples, "kernelPrinciples", assessmentId);
  assertStringArray(raw.dependsOnAssessmentIds, "dependsOnAssessmentIds", assessmentId);

  if (raw.operationalSurface !== undefined && raw.operationalSurface !== null) {
    assertString(raw.operationalSurface, "operationalSurface", assessmentId);
  }

  return {
    assessmentId,
    name: raw.name,
    portfolioSlug: raw.portfolioSlug,
    taxonomyNodePath: raw.taxonomyNodePath ?? null,
    capabilityCategory: raw.capabilityCategory,
    riskTier: raw.riskTier,
    maturityScore,
    confidenceGrade: raw.confidenceGrade,
    strategicOwnership: raw.strategicOwnership,
    vendorReplacementConfidence: raw.vendorReplacementConfidence,
    installScope: raw.installScope,
    productizationStatus: raw.productizationStatus,
    parityChecklistEvidence,
    existingPrimitives: raw.existingPrimitives,
    maturityGaps: raw.maturityGaps,
    evidenceSources: raw.evidenceSources,
    hiveMindSignals: raw.hiveMindSignals,
    kernelPrinciples: raw.kernelPrinciples,
    operationalSurface: raw.operationalSurface ?? null,
    dependsOnAssessmentIds: raw.dependsOnAssessmentIds,
  };
}

export function loadAgentControlPlaneMaturitySeedRows(): AgentControlPlaneMaturitySeedRow[] {
  const rawRows = readJson<unknown[]>(SEED_FILE);
  return rawRows.map(parseSeedRow);
}

export function loadValidKernelPrincipleSlugs(dir = DEFAULT_KERNEL_PRINCIPLES_DIR): Set<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.replace(/\.md$/, "")),
  );
}

function resolveKernelPrincipleSlugs(options: SeedValidationOptions): ReadonlySet<string> {
  return options.kernelPrincipleSlugs ?? loadValidKernelPrincipleSlugs(options.kernelPrinciplesDir);
}

export function validateAgentControlPlaneMaturitySeedRows(
  rows: AgentControlPlaneMaturitySeedRow[],
  options: SeedValidationOptions = {},
): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.assessmentId)) {
      throw new Error(`Duplicate capability maturity assessment seed id: ${row.assessmentId}`);
    }
    ids.add(row.assessmentId);

    if (row.vendorReplacementConfidence === "verified" && (row.parityChecklistEvidence ?? []).length === 0) {
      throw new Error(
        `Seed row ${row.assessmentId} claims vendorReplacementConfidence="verified" without parityChecklistEvidence.`,
      );
    }
  }

  const unknownDependencies: Array<{ assessmentId: string; dependencyId: string }> = [];
  for (const row of rows) {
    for (const dependencyId of row.dependsOnAssessmentIds) {
      if (!ids.has(dependencyId)) {
        unknownDependencies.push({ assessmentId: row.assessmentId, dependencyId });
      }
    }
  }
  if (unknownDependencies.length > 0) {
    throw new Error(
      `Unknown maturity dependency in seed: ${unknownDependencies
        .map((entry) => `${entry.assessmentId}->${entry.dependencyId}`)
        .join(", ")}`,
    );
  }

  validateCapabilityDependencyGraph(
    rows.map((row) => ({
      id: row.assessmentId,
      dependsOnIds: row.dependsOnAssessmentIds,
    })),
  );

  const validPrinciples = resolveKernelPrincipleSlugs(options);
  const unknownPrinciples: Array<{ assessmentId: string; slug: string }> = [];
  for (const row of rows) {
    for (const slug of row.kernelPrinciples) {
      if (!validPrinciples.has(slug)) {
        unknownPrinciples.push({ assessmentId: row.assessmentId, slug });
      }
    }
  }
  if (unknownPrinciples.length > 0) {
    throw new Error(
      `Unknown kernelPrinciples slugs in maturity seed: ${unknownPrinciples
        .map((entry) => `${entry.assessmentId}->${entry.slug}`)
        .join(", ")}`,
    );
  }
}

function assessmentData(
  row: AgentControlPlaneMaturitySeedRow,
  portfolioId: string,
  taxonomyNodeId: string | null,
) {
  return {
    name: row.name,
    portfolioId,
    taxonomyNodeId,
    capabilityCategory: row.capabilityCategory,
    riskTier: row.riskTier,
    maturityScore: row.maturityScore,
    confidenceGrade: row.confidenceGrade,
    strategicOwnership: row.strategicOwnership,
    vendorReplacementConfidence: row.vendorReplacementConfidence,
    installScope: row.installScope,
    archetypeScope: null,
    productizationStatus: row.productizationStatus,
    productizationStatusChangedAt: null,
    parityChecklistEvidence: json(row.parityChecklistEvidence ?? []),
    existingPrimitives: json(row.existingPrimitives),
    maturityGaps: json(row.maturityGaps),
    evidenceSources: json(row.evidenceSources),
    hiveMindSignals: json(row.hiveMindSignals),
    kernelPrinciples: [...row.kernelPrinciples],
    operationalSurface: row.operationalSurface ?? null,
    hasContinuousEvidence: false,
    evidenceFreshnessAt: null,
    lastGovernanceReviewAt: null,
    assessedBy: "seed",
  };
}

export async function seedAgentControlPlaneMaturity(
  prisma: PrismaClient,
  options: SeedValidationOptions = {},
): Promise<void> {
  const rows = loadAgentControlPlaneMaturitySeedRows();
  validateAgentControlPlaneMaturitySeedRows(rows, options);

  const created = new Map<string, string>();

  for (const row of rows) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: row.portfolioSlug },
      select: { id: true },
    });
    if (!portfolio) {
      throw new Error(`Missing portfolio for maturity seed: ${row.portfolioSlug}`);
    }

    const taxonomyNode = row.taxonomyNodePath
      ? await prisma.taxonomyNode.findUnique({
          where: { nodeId: row.taxonomyNodePath },
          select: { id: true },
        })
      : null;
    if (row.taxonomyNodePath && !taxonomyNode) {
      throw new Error(`Missing taxonomy node for maturity seed: ${row.taxonomyNodePath}`);
    }

    const data = assessmentData(row, portfolio.id, taxonomyNode?.id ?? null);
    const assessment = await prisma.capabilityMaturityAssessment.upsert({
      where: { assessmentId: row.assessmentId },
      update: data,
      create: {
        assessmentId: row.assessmentId,
        ...data,
      },
      select: { id: true },
    });

    created.set(row.assessmentId, assessment.id);
  }

  await prisma.capabilityMaturityDependency.deleteMany({
    where: { assessmentId: { in: [...created.values()] } },
  });

  for (const row of rows) {
    const assessmentId = created.get(row.assessmentId);
    if (!assessmentId) {
      throw new Error(`Missing created maturity assessment id for seed: ${row.assessmentId}`);
    }

    for (const dependencyAssessmentId of row.dependsOnAssessmentIds) {
      const dependencyId = created.get(dependencyAssessmentId);
      if (!dependencyId) {
        throw new Error(`Missing maturity dependency seed: ${dependencyAssessmentId}`);
      }

      await prisma.capabilityMaturityDependency.create({
        data: { assessmentId, dependencyId },
      });
    }
  }
}
