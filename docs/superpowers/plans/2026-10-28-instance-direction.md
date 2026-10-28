---
status: draft
---

# Plan: the instance's direction (mission, vision, outcomes)

**Spec:** [instance direction design](../specs/2026-10-28-instance-direction-design.md). **Backlog:** BI-916216E7 (phases 1 to 3), BI-8AB6B4F7 (phase 4). **Epic:** EP-OUTCOME-HIERARCHY.

Each phase is test-first: write the failing test, make it pass, then run the package typecheck.

## Phase 1: data (BI-916216E7, AC-1, AC-2)

- Migration: `BusinessContext.vision`, plus the `InstanceOutcome` and `InstanceDirectionRevision` tables, with FK indexes on `organizationId` and `changedByUserId`.
- `apps/web/lib/organization-direction/direction.ts`: pure validation (`sanitizeDirectionInput`, at most 5 outcomes, bounded lengths) and `saveOrganizationDirection` (fields, outcome retire and upsert, next revision in one transaction).
- Tests: validation and the transaction's writes, using a fake client.

## Phase 2: owner entry (BI-916216E7, AC-1, AC-6)

- A server action `saveDirectionAction`, admin-only, calls `saveOrganizationDirection` and then re-renders Block 0.
- The `DirectionPanel` client component uses shared form primitives and theme tokens. The business settings page renders it above `BusinessContextForm`. Mission moves out of `BusinessContextForm`.
- Tests: panel render and save payload. The form test no longer expects mission.

## Phase 3: setup and Needs-you (BI-916216E7, AC-3, AC-4)

- A `direction` step in `SETUP_STEPS` and `STEP_ROUTES`, an i18n label, and an overlay trigger.
- `attention/sources/organization-direction.ts`, registered in the aggregate, copy maps and outside-in map.
- Tests: step order and route, gap detection, and the single item.

## Phase 4: decision layers read it (BI-8AB6B4F7, AC-5, AC-6)

- `org-context-bundle.ts`: load vision and outcomes, and add bounded Vision and Outcomes lines.
- `apply-mission-prompt.ts`: Block 0 renders vision and outcomes.
- `org-business-gate.ts` `loadOrgAlignmentCorpora`: add direction evidence with versioned refs.
- The profession gate records direction refs on its ledger payload.
- Tests: bundle formatting and bounds, Block 0 content, and corpus refs.

## Phase 5: docs and verification

- User guide page for business settings: the Direction panel and the setup step.
- Unit tests, typecheck, guards, and a served-target UX check with screenshots.
