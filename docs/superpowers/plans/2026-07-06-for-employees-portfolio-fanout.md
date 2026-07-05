# For Employees Portfolio Fan-Out Plan

| Field | Value |
|-------|-------|
| BI | BI-7B4E0D82 |
| Epic | EP-BOM-WIRING |
| Date | 2026-07-06 |
| Branch | feat/for-employees-fanout |
| Scope | Complete the For Employees / Workforce DigitalProduct projection beyond finance/tax and the AI Workforce aggregate. |

## Problem

Operator review found the For Employees portfolio still looks finance-heavy. The taxonomy is broad, but the DigitalProduct instance layer is sparse: the prior slice added AI Workforce and tax/remittance, while the broader For Employees functional domains were not materialized as portfolio products.

## Approach

Reuse the existing BOM Workforce surface projector instead of adding a parallel mapping table. The projector already materializes deterministic `DigitalProduct` rows during seed from `BOM_WORKFORCE_SURFACE_MANIFEST`; this plan expands that manifest so the portfolio has one product for every top-level For Employees functional domain, plus the already-known concrete surfaces under their most specific taxonomy nodes.

## Phases

1. Expand the manifest in `packages/db/src/portfolio-sources/bom-workforce-surface-manifest.ts`.
   - Add a `bom-domain-*` product for every top-level `for_employees` taxonomy domain.
   - Move existing concrete surfaces from portfolio-root placement into the best-fit taxonomy domain where one exists.
   - Keep `coverageStatus="used"` and `sourceKind="bom_surface"` through the existing projector.

2. Strengthen tests in `packages/db/src/portfolio-sources/project-bom-workforce-surfaces.test.ts`.
   - Assert every top-level For Employees taxonomy domain has a projected `bom-domain-*` product.
   - Assert every manifest taxonomy node resolves against `taxonomy_v3.json`.
   - Preserve idempotency and non-destructive projection behavior.

3. Update durable design notes.
   - Record that BI-7B4E0D82 is the breadth correction after BI-D5C9C3F7.
   - Keep the single source of truth in the manifest and projector.

## Verification

Targeted source-local verification:

- `pnpm --filter @dpf/db exec vitest run packages/db/src/portfolio-sources/project-bom-workforce-surfaces.test.ts`
- `pnpm --filter @dpf/db exec vitest run packages/db/src/digital-product-registry.test.ts`

Runtime-bound seed/UX verification must run through the shared local-CI sandbox or the canonical install after self-upgrade, not by starting a per-worktree runtime.

## Risks

- Too many rows could make the portfolio noisy. Mitigation: project one product per top-level functional domain, not all 152 taxonomy leaves.
- Concrete surfaces could land at the wrong level. Mitigation: tests verify every declared taxonomy node exists, and product names/descriptions keep the surface/domain distinction clear.
- Operator-authored products must not be overwritten. Mitigation: reuse `projectPortfolioEntries`, which only refreshes projector-owned rows.
