// Supply-chain / SBOM projector (BI-PORTCOV-P4; spec §4.4.4): surface the
// platform's third-party components in the Foundational portfolio.
//
// Two parts, both → Foundational, source `sbom`, reusing the projectPortfolioEntries
// writer (idempotent, non-destructive):
//   1. Licensed dependencies (the curated paid deps — Docker, Neo4j) — ALWAYS
//      present, carrying the paid/licensing detail.
//   2. BomComponent rows (the CycloneDX bill of materials) — DORMANT until an
//      assurance/SBOM run populates BomComponent (composes with EP-ASSURANCE-LEDGER);
//      projects the notable components (frameworks/apps/containers/models, not the
//      ~2000 OSS libraries) with supplier/license/PURL + a paid heuristic.

import { prisma } from "../client";
import { LICENSED_DEPENDENCIES } from "./licensed-dependencies-manifest";
import {
  projectPortfolioEntries,
  type ProjectPortfolioClient,
  type ProjectPortfolioResult,
} from "./project-portfolio-source";
import type { ProjectedPortfolioEntry } from "./types";

const PLATFORM_SERVICES_NODE = "foundational/platform_services";

/** Notable component types to surface (the rest — npm "library" — is long-tail noise). */
const NOTABLE_COMPONENT_TYPES = new Set(["framework", "application", "container", "model"]);

/** Permissive OSS licenses (anything else with a license expression is treated as paid/commercial). */
const OSS_LICENSE = /\b(MIT|Apache|BSD|ISC|MPL|[AL]?GPL|Unlicense|CC0|Zlib|0BSD|WTFPL)\b/i;

/** Editable starter entries for the curated paid/licensed dependencies. */
export function licensedDependencyEntries(): ProjectedPortfolioEntry[] {
  return LICENSED_DEPENDENCIES.map((dep) => ({
    productId: `dep-${dep.id}`,
    name: dep.name,
    description: `${dep.description} Third-party licensed dependency (paid · ${dep.licenseBasis} license · ${dep.supplier}).`,
    portfolioSlug: "foundational" as const,
    taxonomyNodeId: PLATFORM_SERVICES_NODE,
    coverageStatus: "used" as const,
    sourceKind: "sbom" as const,
  }));
}

export type ProjectSbomClient = ProjectPortfolioClient & {
  bomComponent: { findMany: (args: unknown) => Promise<unknown> };
};

type BomComponentRow = {
  componentKey: string;
  name: string;
  version: string | null;
  componentType: string | null;
  supplierName: string | null;
  licenseExpression: string | null;
  packageUrl: string | null;
};

/** Map notable BomComponent rows to Foundational component entries. */
export function bomComponentEntries(components: BomComponentRow[]): ProjectedPortfolioEntry[] {
  return components
    .filter((c) => c.componentType !== null && NOTABLE_COMPONENT_TYPES.has(c.componentType))
    .map((c) => {
      const paid = !!c.licenseExpression && !OSS_LICENSE.test(c.licenseExpression);
      const detail = [
        c.supplierName,
        c.licenseExpression ? `${c.licenseExpression} license` : null,
        paid ? "paid" : "free",
        c.packageUrl,
      ].filter(Boolean);
      return {
        productId: `sbom-${c.componentKey}`,
        name: `${c.name}${c.version ? ` ${c.version}` : ""}`,
        description: `Third-party ${c.componentType} in the platform bill of materials${detail.length ? ` — ${detail.join(" · ")}` : ""}.`,
        portfolioSlug: "foundational" as const,
        taxonomyNodeId: PLATFORM_SERVICES_NODE,
        coverageStatus: "used" as const,
        sourceKind: "sbom" as const,
      };
    });
}

/** Project the notable BomComponent rows (dormant until an SBOM exists). */
export async function projectSbomComponents(
  options: { db?: ProjectSbomClient } = {},
): Promise<ProjectPortfolioResult> {
  const db = options.db ?? (prisma as unknown as ProjectSbomClient);
  const components = (await db.bomComponent.findMany({
    select: {
      componentKey: true,
      name: true,
      version: true,
      componentType: true,
      supplierName: true,
      licenseExpression: true,
      packageUrl: true,
    },
  })) as BomComponentRow[];
  return projectPortfolioEntries(bomComponentEntries(components), { db });
}

/** Licensed dependencies (always present) + SBOM components (when present). */
export async function projectSupplyChain(
  options: { db?: ProjectSbomClient } = {},
): Promise<ProjectPortfolioResult> {
  const db = options.db ?? (prisma as unknown as ProjectSbomClient);
  const licensed = await projectPortfolioEntries(licensedDependencyEntries(), { db });
  const sbom = await projectSbomComponents({ db });
  return {
    total: licensed.total + sbom.total,
    created: licensed.created + sbom.created,
    updated: licensed.updated + sbom.updated,
    skipped: licensed.skipped + sbom.skipped,
  };
}
