// BOM Workforce surface projector (BI-D5C9C3F7, EP-BOM-WIRING).
//
// Materializes the DOC-1996319D Workforce (for_employees) surfaces + the tax-
// remittance exemplar as DigitalProducts, reusing the idempotent, non-destructive
// projectPortfolioEntries writer. This makes the surface-to-DigitalProduct matrix
// STRUCTURAL (backlog can attribute a Workforce-surface item to for_employees via
// DigitalProduct.portfolioId) rather than a written rule — no parallel surface map.

import {
  BOM_WORKFORCE_SURFACE_MANIFEST,
  type BomWorkforceSurface,
} from "./bom-workforce-surface-manifest";
import {
  projectPortfolioEntries,
  type ProjectPortfolioClient,
  type ProjectPortfolioResult,
} from "./project-portfolio-source";
import type { ProjectedPortfolioEntry } from "./types";

const FOR_EMPLOYEES_SLUG = "for_employees" as const;

function toEntry(surface: BomWorkforceSurface): ProjectedPortfolioEntry {
  return {
    productId: surface.productId,
    name: surface.name,
    description: surface.description,
    portfolioSlug: FOR_EMPLOYEES_SLUG,
    taxonomyNodeId: surface.taxonomyNodeId,
    // A surface the workforce actively operates is a "used" internal product.
    coverageStatus: "used",
    sourceKind: "bom_surface",
  };
}

/**
 * Project the BOM Workforce surfaces (DOC-1996319D) as for_employees
 * DigitalProducts. Idempotent + non-destructive (reuses projectPortfolioEntries'
 * projectedBy ownership guard). Called from the seed alongside the other
 * portfolio-source projectors.
 */
export async function projectBomWorkforceSurfaces(
  options: { db?: ProjectPortfolioClient } = {},
): Promise<ProjectPortfolioResult> {
  const entries = BOM_WORKFORCE_SURFACE_MANIFEST.map(toEntry);
  return projectPortfolioEntries(entries, options);
}
