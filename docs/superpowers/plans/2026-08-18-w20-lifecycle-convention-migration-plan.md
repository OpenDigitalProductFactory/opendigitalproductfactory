---
status: draft
---

# W20 record-lifecycle convention — migration plan (OPERATOR REVIEW REQUIRED)

**Status: plan only — nothing in this document is executed by the W20 PR.**
BI-C357FA5A · Simplify & Strengthen W20 · architecture pass 2026-08-16 §3.2-d ·
convention definition: [data-model stewardship runbook §"Record lifecycle
convention"](../../architecture/data-model-stewardship-runbook.md#record-lifecycle-convention).

## What the W20 PR ships (no data movement)

- The convention: `lifecycle RecordLifecycle @default(active)` + `lifecycleAt`
  (+ optional `lifecycleReason`, + declared successor self-relations). Enum
  shipped with W19 (`20260818090000_w19_unified_resource_scheduling_expand`).
- The **pilot family**, born on the convention with zero data:
  `Resource` / `ResourceAvailability` / `ResourceCapacityPool` /
  `ResourceCapacityAllocation`. Substrate judgement: every EXISTING carrier
  has live rows and live readers (e.g. `Workroom.archivedAt` filters WIP,
  `CustomerAccount.mergedIntoId` drives merge chains), so converting any of
  them requires a backfill + reader flip — not "genuinely cheap" — and is
  therefore staged below behind the operator boundary rather than forced into
  this wave.
- The ratchet: `scripts/check-no-new-notactive-conventions.mjs` — NEW
  legacy-convention columns fail CI; the 29 existing carriers are baselined
  shrink-only in `scripts/notactive-conventions-baseline.json`.
- The stewardship-runbook definition (single source of truth for semantics).

## The six legacy conventions → unified mapping

| Legacy convention | Carriers (baseline) | Unified mapping |
| --- | --- | --- |
| `archivedAt` | `Document`, `ProductObjective`, `TaskRun`, `Workroom` | `lifecycle='archived'`, `lifecycleAt=archivedAt` |
| `retiredAt` | `ExecutionRecipe`, `ModelProfile`, `ModelProvider`, `Policy` | `lifecycle='retired'`, `lifecycleAt=retiredAt` |
| `quarantinedAt` family (`quarantinedAt`, `overlapQuarantinedAt`, `conflictQuarantinedAt`) | `EdgeNode`, `FederationLink`, `StorefrontBooking`, `RentalAgreement`, `HospitalityCapacityAllocation` | `lifecycle='quarantined'`, `lifecycleAt=<x>QuarantinedAt`, `lifecycleReason='legacy:<column>'` |
| `supersededBy*Id` | `ComplianceEvidence`, `CoworkerMemoryNote`, `EmployeeAvailabilityWindow`, `EmployeeSchedulingPreference`, `FeatureBuild`, `RecurrenceSchedule`, `TaskNode`, `UserFact` | `lifecycle='superseded'`, `lifecycleAt=updatedAt` at conversion; the pointer column STAYS as a declared, indexed self-relation (the convention keeps successor pointers, it renames nothing) |
| `mergedIntoId` | `City`, `CustomerAccount`, `CustomerContact`, `CustomerSite`, `InventoryEntity`, `InventoryRelationship`, `PlatformIssueReport`, `Region` | `lifecycle='merged'`, `lifecycleAt=updatedAt` at conversion; pointer stays declared+indexed |
| `status="quarantined"` (String status vocabulary) | e.g. coworker memory status unions | handled by the W4 closed-set enum program (`check-no-new-closed-set-strings.mjs`); when a status column becomes an enum, quarantine vocabulary moves to `lifecycle` in the same wave |

## Why migration is an operator boundary

Every carrier has live readers filtering on the legacy column
(`archivedAt: null` WHERE-clauses, merge-chain traversals, quarantine
sweeps). A convention flip is therefore reader-by-reader work with
characterization coverage per family, and several carriers sit on
consequential spines (CustomerAccount merge, Workroom WIP, FederationLink
trust). Blanket conversion is exactly the kind of change the house
expand→contract discipline forbids doing mechanically.

## Ordered migration (per family, expand→contract)

1. **Expand**: add `lifecycle` + `lifecycleAt` (+ `lifecycleReason` where the
   family wants context) alongside the legacy column. Backfill inline in the
   same forward-only migration (`lifecycle` derived per the table above;
   `NOT VALID` for any constraint touching existing rows).
2. **Dual-read**: readers treat `lifecycle != 'active'` OR the legacy column
   as not-active (a shared helper per family, characterization-pinned).
3. **Writer flip**: writers set `lifecycle`/`lifecycleAt`; a trigger-free
   invariant check (guard or test) asserts the legacy column and `lifecycle`
   never diverge during the soak.
4. **Contract** (operator-gated): drop the legacy column (except supersede/
   merge POINTERS, which stay as declared relations), retighten
   `scripts/notactive-conventions-baseline.json` in the same PR.

### Suggested family order (cheapest, least-coupled first)

1. `ExecutionRecipe.retiredAt` / `Policy.retiredAt` (single-reader ops tables)
2. `Document.archivedAt` / `ProductObjective.archivedAt`
3. `ModelProfile`/`ModelProvider.retiredAt` (provider registry sweeps)
4. `TaskRun`/`Workroom.archivedAt` (WIP spine — after the Workroom rename soak)
5. Quarantine family (`EdgeNode`, `FederationLink`, `StorefrontBooking`,
   `RentalAgreement`, `HospitalityCapacityAllocation` — the last one folds
   automatically when the W19 Wave D clone drop lands)
6. Supersede/merge families (CRM merge chains last; they carry MDM crosswalk
   obligations — coordinate with the MDM steward sweeps)

## Rollback posture

Steps 1–3 are additive and reversible (legacy column remains authoritative
until step 4). Step 4 is irreversible and gated on the step-3 divergence
soak being clean per family.
