# Visual recruiting pipeline page (BI-9CC44DC7)

- **BI:** BI-9CC44DC7 — *Visual recruiting pipeline page — the human-facing "one funnel" over getRecruitingPipeline*, epic EP-ECOSYSTEM-ABSORPTION-ARCH.
- **Design:** [docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md](../specs/2026-08-05-greenhouse-ats-absorption-design.md) §4 Phase 2 (Absorb). Builds on the merged read-model `getRecruitingPipeline` (#4067) and its coworker surface (#4075).
- **Prototype:** operator-signed-off 2026-08-06 (read-only funnel + requisition filter).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal & boundary

A **read-only** portal page at `/employee/recruiting` rendering the unified recruiting funnel to operators: native Applications + Greenhouse-staged rows, deduped by crosswalk (via `getRecruitingPipeline`). Count trio (total / native / from-Greenhouse-not-yet-promoted), by-stage summary, source-badged candidate list, and **one control — a requisition filter** (the read-model already accepts `requisitionId`). No write paths; no candidate PII beyond display name / status / stage. Per-row Promote is explicitly out (a separate write-surface BI).

## Design grounding

- **Existing specs/plans reviewed:** `docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md` §4 Phase 2 — the read-model + surfacing sequence.
- **Current code substrate reviewed:** `apps/web/lib/recruiting/pipeline-read-model.ts` (`getRecruitingPipeline`, the data source); `apps/web/app/(shell)/employee/page.tsx` (the People page — the sibling pattern: `prisma` from `@dpf/db`, `auth()`, `can(...)` from `@/lib/permissions`, `export const dynamic = "force-dynamic"`, read-model → client component); `apps/web/lib/ux-budget/purpose-contracts/right-now.ts` + `index.ts` (the ratified-contract pattern for a new route); `apps/web/lib/govern/permissions.ts:199` (the `employee`/`view_employee` nav section).
- **Source of truth:** `getRecruitingPipeline` — the page and the coworker tool read one read-model so they never drift.
- **Decision:** read-only page in the People area (`/employee/recruiting`), sibling to the People grid; capability `view_employee` (no `view_recruiting` exists — reuse the People read floor).

## Phases (atomic — one route, one deliverable)

1. **Requisition-list read fn.** New `listRecruitingRequisitions(db)` in `apps/web/lib/recruiting/requisitions-read-model.ts` (`db.jobRequisition.findMany` → `{id, reqId, title, status}`), with a narrow structural client type + unit test. *Verify:* unit test with a fake db; `tsc`.
2. **Page + client component.** `apps/web/app/(shell)/employee/recruiting/page.tsx` (server: `auth()` + `can(view_employee)`, `force-dynamic`, calls both read-models, passes `initialData`) → `apps/web/components/recruiting/RecruitingPipelinePanel.tsx` (client: count trio, by-stage chips, source-badged list, requisition `<select>` filter that re-reads via a server action or `?requisitionId=` param). Colors via CDS tokens only. *Verify:* renders both states (empty + populated) in a component test.
3. **Route registration.** `pnpm route:sync` (regenerates route-manifest.json, route-shells.generated.json, route-audience, doc-index — never hand-edit). Confirm `/employee/recruiting` inherits `owner` audience; add a `route-context-map` entry only if the conformance test demands it. Wire nav findability: an `EmployeeTabNav` entry (or People-area nav) so the page is reachable. *Verify:* `route-sync-contract.test.mjs`; nav entry matches the contract's `findability.entryPoints`.
4. **Ratified purpose contract.** `apps/web/lib/ux-budget/purpose-contracts/recruiting-pipeline.ts` (mirror `right-now.ts`: intent + findability + contentRoles + familyConsistency, stateScenarios [empty-funnel, populated, filtered-empty], taskProtocol, ratifiedBy operator-request, reviewRef BI-9CC44DC7, intentEvidenceRefs). Register in `index.ts` (import + `CONTRACT_MODULES` entry; unique routePath). *Verify:* `pnpm build:page-purpose`; `page-purpose.test.ts`.
5. **ux-fit sweep + baseline.** `pnpm ux:sweep -- --update-baseline` to freeze `/employee/recruiting` into `route-budget-baseline.json` (a new route + one filter control triggers `structureChanged`; freeze only this route's entry). *Verify:* `ux:sweep` clean after baseline.
6. **Verify + govern.** Full local vitest; `tsc`; docs-impact (Docs-Impact-Decision trailer for the new route + any doc-index change).

## Risks & rollback

- **New-route gauntlet** is the blast radius: generated manifests + baseline. Regenerate with the commands, never hand-edit; commit generated artifacts together.
- **`structureChanged` blocks the ux sweep** on any added control (ratchet.ts) — re-baseline then splice only this route's entry (per the batch-1 dance).
- **PR_BODY / route audience**: `/employee` first-segment already maps to `owner`; no override needed.
- Rollback = remove the route dir, the contract (file + index entry), the read fn, the nav entry, and revert the regenerated manifests + baseline.

## Backlog coverage

- **Decision:** `atomic` — one BI (BI-9CC44DC7); the page, its read fn, contract, and registration are one indivisible route deliverable, nothing independently shippable.
- **Receipt:** `cmsifhjw90ue201qrzja042x1` (recorded 2026-08-06 against BI-9CC44DC7).
- **Deliverables (none independently shippable):** requisition read fn → page + panel → route registration → purpose contract → ux baseline.
- **Deferred (separate BI):** per-row Promote write action; full candidate detail drill-in.
