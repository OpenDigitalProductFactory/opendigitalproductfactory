# BOM Structural Reassociation + Surface DigitalProducts — Implementation Plan

**Date:** 2026-07-05
**Epic:** EP-BOM-WIRING
**BIs:** BI-87A8BF2A (structural Workforce reassociation for AI-coworker backlog), BI-D5C9C3F7 (structural surface→DigitalProduct mappings)
**Consumes:** DOC-1996319D (surface→DigitalProduct matrix + reassociation rule), DOC-7693D528 (coworker parity/approval invariant). Predecessors BI-058BEB95 / BI-2BB3DB23 produced DOC-1996319D as evidence; these two BIs make it structural.

## Substrate reused (verify-substrate-first wins)
- `resolveBacklogPortfolio` / `attributeBacklogPortfolio` / `backfillBacklogPortfolios` **already exist** (`packages/db/src/backlog-portfolio.ts`) — the DigitalProduct→taxonomy→epic precedence resolver + the denormalized `BacklogItem.portfolioId` cache writer. No new resolver.
- The idempotent, non-destructive `projectPortfolioEntries` portfolio-source writer.
- `BacklogItem.digitalProductId → DigitalProduct.id`, `taxonomyNodeId → TaxonomyNode.id`, `portfolioId` (denormalized cache).

## BI-D5C9C3F7 — surface→DigitalProduct mappings
- **`bom-workforce-surface-manifest.ts`**: the `for_employees` rows of the DOC-1996319D matrix (AI Workforce Operations, Workforce Roster, AI Coworker Services Catalog, Portfolio Management Cockpit, Finance Operations Work Lane) **plus the tax-remittance exemplar** (`Tax Remittance / Paying Taxes`, taxonomy `for_employees/financial_management`).
- **`project-bom-workforce-surfaces.ts`**: projector reusing `projectPortfolioEntries` (`sourceKind: "bom_surface"`, added to the closed enum). Materializes each surface as a `for_employees` DigitalProduct. Wired into `seed.ts` (`bomWorkforceSurfaces` step) + `index.ts`. Idempotent + non-destructive; no parallel surface-map table.

## BI-87A8BF2A — governed structural write path
Closes the DOC-1996319D "Open Implementation Gap" (external MCP couldn't write `BacklogItem.digitalProductId` / `taxonomyNodeId` / `portfolioId`).
- **`update_backlog_item`** MCP tool (`apps/web/lib/mcp-tools.ts`): accepts `digitalProductId` (productId → resolves to `DigitalProduct.id`), `taxonomyNodeId` (nodeId → `TaxonomyNode.id`), and `portfolioSlug` (slug → `Portfolio.id`, explicit override). After setting links, calls the existing `attributeBacklogPortfolio` to re-derive the `portfolioId` cache via the DigitalProduct→taxonomy→epic rule; returns the resolved `portfolioId`.
- **Effect:** an AI-coworker / Workforce backlog item linked to a coworker or surface DigitalProduct (both `portfolioId = for_employees`) now resolves structurally to `for_employees` — the AC. Hive Scout coworker-archetype + capability items gain the same path (link a product → attribution follows).

## Verification
- `@dpf/db` `vitest run src/portfolio-sources` (new surface projector suite) + `src/backlog-portfolio` (resolver unchanged, still green).
- `@dpf/db` + `apps/web` `tsc --noEmit`; `pnpm --filter web build`.
- Execution evidence on both BIs; close when merged to `main`.

## Notes
- `mcp-tools.ts` is a large module (Module Size Guard is advisory, non-blocking) — this extends an existing tool rather than adding a new one, per the context-engineering "few, consolidated tools" rule; tool descriptions kept provenance-free (hygiene guard).
