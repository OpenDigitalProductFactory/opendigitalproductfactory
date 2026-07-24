// Portfolio source-projection contract + coverage axis (EP-BOM-WIRING; spec:
// docs/superpowers/specs/2026-06-21-portfolio-coverage-multisource-projection-design.md).
//
// The portfolio surface is meant to be populated from every substrate that
// already knows about a real (or potential) digital product — not only network
// discovery. A PortfolioSourceProjector reads one such substrate and returns
// portfolio entries to materialize; it never becomes a second source of truth.
//
// Two closed string enums (AGENTS.md §3 strongly-typed-string-enums) carry the
// new dimensions. Their canonical values + types live here. The DB home today is
// DigitalProduct.observationConfig JSON (see project-portfolio-source.ts); the
// typed-column migration is deferred to BI-PORTCOV-P0's runtime-available
// follow-up (a source-only worktree cannot generate/verify a Prisma migration).

/**
 * Coverage axis — what relationship the org has to this portfolio entry, ordered
 * most-committed → least. "potential" is the planning surface: catalogued and one
 * governed click from being enabled, never auto-activated.
 *
 * "incumbent" is distinct from "used": both are actively in use, but "used" means
 * DPF's own stack while "incumbent" is a third-party application the customer pays
 * for today and DPF intends to displace (spec 2026-07-23-incumbent-application-
 * coverage-design.md §5.1, BI-5B2F5447). It sits beside "used" in the committed
 * tier because it is real, in-production use — just sourced externally.
 */
export const PORTFOLIO_COVERAGE_STATUSES = [
  "used", // actively in use by the org (DPF's own stack)
  "incumbent", // a third-party app the customer runs today and DPF aims to displace
  "sold", // a market offer (revenue-generating)
  "available", // integrated and configurable now (e.g. credential present but idle)
  "potential", // catalogued; one governed click to enable
  "planned", // on the roadmap
  "retired", // decommissioned
] as const;
export type PortfolioCoverageStatus = (typeof PORTFOLIO_COVERAGE_STATUSES)[number];

/** Where a projected portfolio entry came from (provenance). */
export const PORTFOLIO_SOURCE_KINDS = [
  "network_discovery", // existing: the discovery sweep
  "manual_entry", // existing: digital_product_registry.json / operator
  "platform_capability", // this platform's own subsystems (Build Studio, GitHub, …)
  "capability_registry", // capability-registry.ts capability modules
  "integration_registry", // McpIntegration / IntegrationCredential
  "ai_provider", // ModelProvider / providers-registry.json
  "sbom", // BomComponent (CycloneDX)
  "archetype", // archetype-seeded offers / suppliers / goods
  "coworker_service", // Agent / CoworkerService — AI coworkers as Workforce products (BI-8F9EDD6C)
  "bom_surface", // DOC-1996319D Workforce surfaces (AI Workforce Ops, roster, finance/tax) (BI-D5C9C3F7)
  "incumbent_intake", // customer's existing app stack: manual entry / spreadsheet import / discovery (BI-5B2F5447)
] as const;
export type PortfolioSourceKind = (typeof PORTFOLIO_SOURCE_KINDS)[number];

/** Canonical portfolio root slugs (packages/db/data/portfolio_registry.json). */
export const PORTFOLIO_SLUGS = [
  "foundational",
  "manufacturing_and_delivery",
  "for_employees",
  "products_and_services_sold",
] as const;
export type PortfolioSlug = (typeof PORTFOLIO_SLUGS)[number];

/** One portfolio entry a projector wants materialized, before it is written. */
export interface ProjectedPortfolioEntry {
  /** Stable, deterministic product id so re-projection is idempotent (no dupes). */
  productId: string;
  name: string;
  description: string;
  portfolioSlug: PortfolioSlug;
  /** Existing taxonomy nodeId string, or null to place at the portfolio root. */
  taxonomyNodeId: string | null;
  coverageStatus: PortfolioCoverageStatus;
  sourceKind: PortfolioSourceKind;
  /**
   * Extra string markers merged into DigitalProduct.observationConfig alongside
   * the coverage/source/projectedBy markers. Used by projectors that carry
   * projector-specific facts on the row — e.g. the coworker projector stamps the
   * AI coworker's agentId, human-role parity anchor, and approval/interface owner
   * (BI-8F9EDD6C / DOC-7693D528). Optional; omitted for projectors that don't.
   */
  observationExtras?: Record<string, string>;
}

/**
 * A projector reads one substrate and returns portfolio entries. The substrate
 * stays canonical; the projector materializes a *view* into the portfolio.
 */
export interface PortfolioSourceProjector {
  readonly source: PortfolioSourceKind;
  project(): ProjectedPortfolioEntry[] | Promise<ProjectedPortfolioEntry[]>;
}

/** Keys the projector writes into DigitalProduct.observationConfig. */
export const PORTFOLIO_PROJECTION_KEYS = {
  coverageStatus: "coverageStatus",
  sourceKind: "sourceKind",
  projectedBy: "projectedBy",
} as const;

/** Marker value identifying a DigitalProduct row owned by a source projector. */
export const PROJECTED_BY = "portfolio-source-projector";

export function isPortfolioCoverageStatus(v: string): v is PortfolioCoverageStatus {
  return (PORTFOLIO_COVERAGE_STATUSES as readonly string[]).includes(v);
}

export function isPortfolioSourceKind(v: string): v is PortfolioSourceKind {
  return (PORTFOLIO_SOURCE_KINDS as readonly string[]).includes(v);
}

export function isPortfolioSlug(v: string): v is PortfolioSlug {
  return (PORTFOLIO_SLUGS as readonly string[]).includes(v);
}
