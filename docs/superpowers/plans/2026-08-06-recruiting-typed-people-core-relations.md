# Typed People-Core relations for the recruiting models (BI-7ACC38CE)

- **BI:** BI-7ACC38CE — *Typed People-Core relations for the recruiting models — soft crosswalk FKs → Prisma relations*, epic EP-ECOSYSTEM-ABSORPTION-ARCH.
- **Design:** [docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md](../specs/2026-08-05-greenhouse-ats-absorption-design.md) §4 (native models) + §9 (HCM coordination).
- **Kernel:** WWMD ledger `DI-A114C610DFD9` — `typed-all` (composite 5.92, margin 1.87, high confidence, no commandment conflict).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal & boundary

Harden the recruiting↔People-Core links: convert the recruiting models' soft scalar FKs into typed Prisma relations against the canonical People-Core models (Position, Department, WorkLocation, EmploymentType, EmployeeProfile), now that BI-HCM-001 (canonical model) is done and the targets are stable. All relations **nullable**, `onDelete: SetNull` — a requisition/scorecard survives the removal of a position, department, location, type, or employee. Additive back-relations only; no change to existing columns, no data migration.

## Design grounding

- **Existing specs/plans reviewed:** `docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md` §4/§9 — the native recruiting models and the HCM-coordination contract this hardens.
- **Current code substrate reviewed:** `packages/db/prisma/schema.prisma` — the recruiting models (`JobRequisition` L16429, `Scorecard` L16594) and the canonical People-Core targets (`EmployeeProfile` L410, `Department` L503, `Position` L523, `EmploymentType` L579, `WorkLocation` L591), which already carry typed `employees EmployeeProfile[]` back-relations (the exact pattern these follow); `apps/web/lib/integrate/greenhouse/*` and `apps/web/lib/recruiting/*` — confirmed neither writes these FK columns (external refs live in `StagedRecord` + `MasterDataSourceRef`).
- **Source of truth:** the canonical People-Core models (BI-HCM-001, done). Recruiting rows point at their stable `id` PKs.
- **Decision:** typed-all (kernel `DI-A114C610DFD9`) — referential integrity + query ergonomics, additive and convergent with BI-41901810.

## Coordination (HCM owners)

- Converges with **BI-41901810** (Position lifecycle — "a requisition hangs off a position") and serves **BI-F3AEBF68** (requisition→hire→worker). Neither, nor **BI-36FEECC4** (effective-dating spine), has an active build → no collision.
- Effective-dating unaffected: FKs target stable `id` PKs; effective-dating makes worker *attributes* dated rows, not identity.

## Phases (atomic — one indivisible schema change)

1. **JobRequisition typed relations.** Add `@relation` for `positionId`→Position, `departmentId`→Department, `workLocationId`→WorkLocation, `employmentTypeId`→EmploymentType, `hiringManagerId`→EmployeeProfile (named `ReqHiringManager`), `recruiterId`→EmployeeProfile (named `ReqRecruiter`); all `onDelete: SetNull`. Add back-relations: `requisitions JobRequisition[]` on Position/Department/WorkLocation/EmploymentType; `requisitionsAsHiringManager`/`requisitionsAsRecruiter` on EmployeeProfile. *Verify:* `prisma validate` passes; both sides named consistently.
2. **Scorecard.submittedBy.** Add `submittedById`→EmployeeProfile (named `ScorecardSubmitter`, `onDelete: SetNull`) + `scorecardsSubmitted Scorecard[]` on EmployeeProfile. *Verify:* `prisma validate`.
3. **Migration.** Generate via `prisma migrate diff --from-schema-datamodel (base) --to-schema-datamodel (head)` (no DB) — nullable FK constraints, `ON DELETE SET NULL`, no column adds/drops. *Verify:* migration SQL is constraint-only; `prisma validate`.
4. **Verify + govern.** `tsc --noEmit`; existing recruiting + pipeline-read-model + promote-hire tests stay green; add a test asserting a Prisma `include` traverses `JobRequisition.position`/`hiringManager` and `Scorecard.submittedBy`. Satisfy the Data-Impact gate (schema change) + any stewardship classification (no new tables).

## Risks & rollback

- **FK constraint vs existing data:** all columns already nullable; absorption never writes external ids here (verified). Rollback = revert the schema block + drop the migration.
- **Named-relation drift:** two EmployeeProfile links from JobRequisition require named relations on both sides — `prisma validate` catches mismatch.
- **Blast radius:** additive relation fields + FK constraints on existing nullable columns; no column/data change.

## Backlog coverage

- **Decision:** `atomic` — one BI (BI-7ACC38CE); the schema relations + migration are a single indivisible change, nothing independently shippable.
- **Receipt:** `cmsi8uzb50k5f01qrfsuqxgtw` (recorded 2026-08-06 against BI-7ACC38CE).
- **Deliverables (none independently shippable):** JobRequisition relations → Scorecard relation → migration → verification.
