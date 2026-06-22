// Portfolio source-projection writer + the first projector (BI-PORTCOV-P1).
//
// Materializes ProjectedPortfolioEntry[] into DigitalProduct rows placed in their
// portfolio (and taxonomy node when one resolves), stamping the coverage axis +
// source provenance into observationConfig. Idempotent (stable productIds) and
// NON-DESTRUCTIVE: a row created by an operator or the manual registry is never
// overwritten — only rows this projector owns (observationConfig.projectedBy)
// are refreshed. Mirrors the seed-market-offer.ts discipline.

import { prisma } from "./client.js";
import {
  PLATFORM_CAPABILITY_MANIFEST,
  type PlatformCapabilityManifestEntry,
} from "./platform-capability-manifest.js";
import {
  PORTFOLIO_PROJECTION_KEYS,
  PROJECTED_BY,
  type PortfolioCoverageStatus,
  type PortfolioSourceProjector,
  type ProjectedPortfolioEntry,
} from "./types.js";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type ProjectPortfolioClient = {
  portfolio: { findUnique: (args: unknown) => Promise<unknown> };
  taxonomyNode: { findUnique: (args: unknown) => Promise<unknown> };
  digitalProduct: {
    findUnique: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
};

export type ProjectPortfolioResult = {
  total: number;
  /** New DigitalProduct rows created. */
  created: number;
  /** Projector-owned rows refreshed. */
  updated: number;
  /** Skipped: portfolio missing, or row exists but is owned by operator/registry. */
  skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * DigitalProduct lifecycle stage/status is derived from the coverage axis so the
 * existing /portfolio surface renders projected entries consistently with the
 * registry-seeded ones (DigitalProduct.lifecycleStage: plan|design|build|
 * production|retirement; lifecycleStatus: draft|active|inactive).
 */
function lifecycleFromCoverage(coverage: PortfolioCoverageStatus): {
  lifecycleStage: string;
  lifecycleStatus: string;
} {
  switch (coverage) {
    case "used":
    case "sold":
      return { lifecycleStage: "production", lifecycleStatus: "active" };
    case "retired":
      return { lifecycleStage: "retirement", lifecycleStatus: "inactive" };
    case "available":
    case "potential":
    case "planned":
    default:
      return { lifecycleStage: "plan", lifecycleStatus: "draft" };
  }
}

/**
 * Write projected portfolio entries to DigitalProduct rows. Idempotent and
 * non-destructive: existing rows not owned by the projector are left untouched.
 */
export async function projectPortfolioEntries(
  entries: ProjectedPortfolioEntry[],
  options: { db?: ProjectPortfolioClient } = {},
): Promise<ProjectPortfolioResult> {
  const db = options.db ?? (prisma as unknown as ProjectPortfolioClient);
  const result: ProjectPortfolioResult = {
    total: entries.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  for (const entry of entries) {
    const portfolio = (await db.portfolio.findUnique({
      where: { slug: entry.portfolioSlug },
      select: { id: true },
    })) as { id: string } | null;
    if (!portfolio) {
      result.skipped++;
      continue;
    }

    let taxonomyNodeId: string | null = null;
    if (entry.taxonomyNodeId) {
      const node = (await db.taxonomyNode.findUnique({
        where: { nodeId: entry.taxonomyNodeId },
        select: { id: true },
      })) as { id: string } | null;
      taxonomyNodeId = node?.id ?? null;
    }

    const projectionMarkers: Record<string, string> = {
      [PORTFOLIO_PROJECTION_KEYS.coverageStatus]: entry.coverageStatus,
      [PORTFOLIO_PROJECTION_KEYS.sourceKind]: entry.sourceKind,
      [PORTFOLIO_PROJECTION_KEYS.projectedBy]: PROJECTED_BY,
    };
    const { lifecycleStage, lifecycleStatus } = lifecycleFromCoverage(entry.coverageStatus);

    const existing = (await db.digitalProduct.findUnique({
      where: { productId: entry.productId },
      select: { id: true, observationConfig: true },
    })) as { id: string; observationConfig: unknown } | null;

    if (!existing) {
      await db.digitalProduct.create({
        data: {
          productId: entry.productId,
          name: entry.name,
          description: entry.description,
          portfolioId: portfolio.id,
          taxonomyNodeId: taxonomyNodeId ?? undefined,
          lifecycleStage,
          lifecycleStatus,
          observationConfig: projectionMarkers,
        },
      });
      result.created++;
      continue;
    }

    // Non-destructive: only rows this projector owns are refreshed. Operator- or
    // registry-authored rows (no projectedBy marker) are left intact.
    const prevConfig = isRecord(existing.observationConfig) ? existing.observationConfig : {};
    const ownedByProjector = prevConfig[PORTFOLIO_PROJECTION_KEYS.projectedBy] === PROJECTED_BY;
    if (!ownedByProjector) {
      result.skipped++;
      continue;
    }

    await db.digitalProduct.update({
      where: { productId: entry.productId },
      data: {
        name: entry.name,
        description: entry.description,
        portfolioId: portfolio.id,
        taxonomyNodeId: taxonomyNodeId ?? undefined,
        lifecycleStage,
        lifecycleStatus,
        observationConfig: { ...prevConfig, ...projectionMarkers },
      },
    });
    result.updated++;
  }

  return result;
}

/** Project this platform's own subsystems into Foundational + Manufacturing & Delivery. */
export const platformCapabilityProjector: PortfolioSourceProjector = {
  source: "platform_capability",
  project(): ProjectedPortfolioEntry[] {
    return PLATFORM_CAPABILITY_MANIFEST.map(toEntry);
  },
};

function toEntry(c: PlatformCapabilityManifestEntry): ProjectedPortfolioEntry {
  return {
    productId: c.productId,
    name: c.name,
    description: c.description,
    portfolioSlug: c.portfolioSlug,
    taxonomyNodeId: c.taxonomyNodeId,
    coverageStatus: c.coverageStatus,
    sourceKind: "platform_capability",
  };
}

/** Convenience entry point for the seed/refresh path. */
export async function projectPlatformCapabilities(
  options: { db?: ProjectPortfolioClient } = {},
): Promise<ProjectPortfolioResult> {
  return projectPortfolioEntries(platformCapabilityProjector.project(), options);
}
