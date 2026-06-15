-- Per-org Digital Product Portfolio decomposition (BI-2D452667, spec
-- docs/superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md §3 / §8 Phase 0).
-- Additive, nullable: holds the PortfolioDecomposition (Record<PortfolioRole,
-- PortfolioProfile>) derived once from the archetype activationProfile at setup
-- completion, then refinable by the operator. Closes the "computed at runtime,
-- never persisted" gap so a company's portfolio shape can be driven from and
-- refined independent of the shared archetype template.

-- AlterTable
ALTER TABLE "BusinessContext" ADD COLUMN "portfolioDecomposition" JSONB;
