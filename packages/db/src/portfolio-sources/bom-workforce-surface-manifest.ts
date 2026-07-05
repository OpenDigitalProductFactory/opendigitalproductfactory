// BOM Workforce surface manifest (BI-D5C9C3F7, EP-BOM-WIRING).
//
// Structural realization of the DOC-1996319D "Surface-to-DigitalProduct Matrix":
// the platform surfaces/functions the workforce operates ARE digital products the
// org uses internally, and belong under the `for_employees` (Workforce) portfolio.
// This manifest names the for_employees rows of that matrix (plus the tax-
// remittance exemplar the doc calls out) so a projector can materialize them as
// DigitalProducts idempotently — no parallel surface-map table.
//
// Note: per-AI-coworker products are produced separately by the coworker projector
// (BI-8F9EDD6C). These are the SURFACE-level Workforce products (the operator/
// coworker tools + the finance/tax business function), not the coworkers.

/** One BOM Workforce surface to materialize as a for_employees DigitalProduct. */
export interface BomWorkforceSurface {
  /** Stable, deterministic product id (idempotent re-projection). */
  productId: string;
  name: string;
  description: string;
  /** Existing taxonomy nodeId string, or null to sit at the portfolio root. */
  taxonomyNodeId: string | null;
}

export const BOM_WORKFORCE_SURFACE_MANIFEST: BomWorkforceSurface[] = [
  {
    productId: "bom-surface-ai-workforce-ops",
    name: "AI Workforce Operations",
    description:
      "The AI Workforce admin & operations surface (/platform/ai): coworker records, capability needs, tool grants, model/token budgets. The workforce-management product the org runs its AI coworkers on.",
    taxonomyNodeId: null,
  },
  {
    productId: "bom-surface-workforce-roster",
    name: "Workforce Roster",
    description:
      "The unified workforce roster spanning human employees and AI coworkers, with the coworker needs lens plus human-role parity anchor and approval/interface owner (DOC-7693D528).",
    taxonomyNodeId: null,
  },
  {
    productId: "bom-surface-ai-coworker-services-catalog",
    name: "AI Coworker Services Catalog",
    description:
      "The catalog of AI coworker services and offers consumed internally — the CoworkerService / CoworkerOffer surface, linked to per-coworker Workforce products.",
    taxonomyNodeId: null,
  },
  {
    productId: "bom-surface-portfolio-management-cockpit",
    name: "Portfolio Management Cockpit",
    description:
      "The employee/coworker-facing tool for managing all four portfolios (/portfolio). A Workforce-facing management surface; the products it manages retain their own portfolios.",
    taxonomyNodeId: null,
  },
  {
    productId: "bom-surface-finance-operations-work-lane",
    name: "Finance Operations Work Lane",
    description:
      "The employee/accountant-coworker finance operations surface (financial management). Depends on Foundational accounting ledger, bank feeds, and identity.",
    taxonomyNodeId: "for_employees/financial_management",
  },
  {
    // DOC-1996319D Tax Remittance exemplar: a Workforce financial-management product.
    productId: "bom-surface-tax-remittance",
    name: "Tax Remittance / Paying Taxes",
    description:
      "Paying taxes / tax remittance as a Workforce financial-management product (consumers: finance employee, accountant coworker, operator). Depends on Foundational accounting/banking/identity and, where tax derives from sales, Products & Services Sold revenue records.",
    taxonomyNodeId: "for_employees/financial_management",
  },
];
