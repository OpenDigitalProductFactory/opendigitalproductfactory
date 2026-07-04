# BOM Workforce Activation + AI Coworker DigitalProducts — Implementation Plan

**Date:** 2026-07-04
**Epic:** EP-BOM-WIRING (Business Operating Model portfolio wiring — Workforce / AI Coworker parity and business portfolio fan-out)
**BIs implemented:** BI-9A5F0EA3, BI-8F9EDD6C
**Consumes (governed artifacts):** DOC-7693D528 (AI Coworker Human-Role Parity and Workforce-Scale Approval Invariant), DOC-1996319D (BOM Workforce Portfolio Reassociation and Surface-to-DigitalProduct Matrix), and the BOM design spec [`2026-06-07-business-operating-model-portfolio-wiring-design.md`](../specs/2026-06-07-business-operating-model-portfolio-wiring-design.md).
**Predecessors (done, not redone):** BI-058BEB95 + BI-2BB3DB23 (their artifact is DOC-1996319D); BI-554E1A14 (Phase 2 unified roster + panel); BI-4503E6B9 (Phase 1 market offer); the portfolio-source projector framework (EP-PORTCOV).

---

## Governing invariant (DOC-7693D528)

AI coworkers are **role-shaped non-human workforce peers**, not detached automation. Each maps to an equivalent/adjacent human role; the responsible human **approval/interface owner** starts BROAD (an HR role) in a small org and becomes SPECIFIC (a named employee) as headcount converges. Portfolio/product/backlog projections must preserve *coworker role ↔ human counterpart/supervisor ↔ approval/interface owner*, and must not introduce a parallel identity or coworker-product registry.

## Substrate reused (no parallel structures)

`Portfolio` (root `for_employees`), `DigitalProduct` (`portfolioId`, `lifecycleStage`, `observationConfig`), `Agent` (`portfolioId`, `valueStream`, `humanSupervisorId`, `kind`, `coworkerServices`), `CoworkerService.digitalProductId`, `CoworkerCapabilityNeed.linkedBacklogItemId`, `PlatformRole` → `UserGroup` → `User` → `EmployeeProfile`, and the idempotent `projectPortfolioEntries` writer.

---

## BI-9A5F0EA3 — Activate For Employees as Workforce

1. **Roster projection** ([`apps/web/lib/workforce/workforce-roster.ts`](../../../apps/web/lib/workforce/workforce-roster.ts)) — extend `AgentNeeds` with `humanRoleParity` (the supervising HR role, resolved to its name) and `approvalInterfaceOwner` (`scope: employee | role | unassigned`). The owner resolves BROAD→SPECIFIC: when exactly one active employee holds the supervising role, the owner is that named employee; otherwise the role (broad); otherwise unassigned. Resolution reads only the supervising roles actually referenced (`PlatformRole.findMany` on the collected `humanSupervisorId`s). Degrades to broad when no `platformRole` reader is present.
2. **Roster panel** ([`WorkforceRosterPanel.tsx`](../../../apps/web/components/employee/WorkforceRosterPanel.tsx)) — render `role parity` + `approval owner (scope)`; relabel "AI agent(s)" → "AI coworker(s)".
3. **Portfolio label** ([`portfolio_registry.json`](../../../packages/db/data/portfolio_registry.json)) — `for_employees.name` "For Employees" → "Workforce / For Employees"; description now names AI coworkers as members. **Canonical key/slug `for_employees` is unchanged** (upsert is keyed by slug → zero data churn). Label map [`work-capsule-presenter.ts`](../../../apps/web/lib/work-capsules/work-capsule-presenter.ts) follows.
4. **Tests** — `workforce-roster.test.ts` updated for the new shape + broad/specific/unassigned owner resolution.

## BI-8F9EDD6C — AI coworkers as Workforce DigitalProducts

1. **Projector** ([`project-coworker-workforce.ts`](../../../packages/db/src/portfolio-sources/project-coworker-workforce.ts)) — new `PortfolioSourceProjector` (`sourceKind: "coworker_service"`, added to the closed enum in [`types.ts`](../../../packages/db/src/portfolio-sources/types.ts)). Projects each non-archived `Agent` as a `DigitalProduct` (`productId = coworker-<agentId>`) under `for_employees`, carrying the human-role parity anchor + approval/interface owner in `observationConfig` (via the new optional `observationExtras` on `ProjectedPortfolioEntry`, merged by the shared writer). Then back-links WITHOUT churn: `Agent.portfolioId → for_employees` (only when unset) and `CoworkerService.digitalProductId → coworker-<agentId>` (only where unset). Idempotent + non-destructive (reuses `projectPortfolioEntries`' `projectedBy` ownership guard).
2. **Seed wiring** ([`seed.ts`](../../../packages/db/src/seed.ts)) — `coworkerWorkforcePortfolio` step after `coworkerServiceCatalog` (so services exist to link) and `platformCapabilityPortfolio`.
3. **Reassociation path** — once linked, `BacklogItem.digitalProductId → DigitalProduct.portfolioId = for_employees` resolves an AI-coworker item's portfolio (DOC-1996319D "DigitalProduct first" rule); capability needs resolve via `CoworkerCapabilityNeed.linkedBacklogItemId → BacklogItem`.
4. **Tests** — `project-coworker-workforce.test.ts` (create, portfolio/service back-link, non-destructive skip, idempotent update, empty no-op, coverage-by-status).

## Verification

- `pnpm --filter @dpf/db exec vitest run portfolio-sources/project-coworker-workforce`
- `pnpm --filter web exec vitest run lib/workforce/workforce-roster`
- `pnpm --filter web typecheck` + `pnpm --filter web build`
- Execution evidence recorded on both BIs via `record_execution_evidence`.

## Explicit deferred sub-item (kept honest)

BI-8F9EDD6C AC2 asks that the **product detail page itself** render the parity anchor + approval/interface owner for a coworker product. The data is now linked and reachable (parity/owner on `observationConfig`; services/offers/backlog/knowledge via the existing `/portfolio/product/[id]/*` sub-routes), and parity/owner ARE shown in the primary coworker surface (the Workforce roster). Rendering them on `DigitalProductDetail` requires extending `toDigitalProductViewModel` + the detail component — a thin follow-up tracked under EP-BOM-WIRING. BI-8F9EDD6C is therefore **not** marked done on that criterion until the product-page render + live-portal proof land.
