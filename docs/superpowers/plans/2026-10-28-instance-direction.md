---
status: draft
---

# Plan: the instance's direction (mission, vision, outcomes)

**Spec:** [instance direction design](../specs/2026-10-28-instance-direction-design.md). **Backlog item:** BI-916216E7 (phases 1 to 3; BI-8AB6B4F7 covers phase 4). **Epic:** EP-OUTCOME-HIERARCHY.

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

## Backlog coverage

| Deliverable | Backlog item | Requirements | Contract | Flow | Verification |
|---|---|---|---|---|---|
| capture-and-edit | BI-916216E7 | AC-1, AC-2, AC-3, AC-4 | `docs/superpowers/specs/2026-10-28-instance-direction-design.md` | `/storefront/settings/business?section=direction` | `apps/web/lib/organization-direction/direction.test.ts`, `apps/web/lib/attention/sources/organization-direction.test.ts` |
| decision-layers-read | BI-8AB6B4F7 | AC-5, AC-6 | `docs/superpowers/specs/2026-10-28-instance-direction-design.md` | `mcp initialize ORGANIZATION CONTEXT`, `evaluate_org_business_decision` | `apps/web/lib/mcp/org-context-bundle.test.ts`, `apps/web/lib/onboarding/apply-mission-prompt.test.ts` |

BI-916216E7 acceptance, quoted from the item:

- AC-1 Setup asks for mission, vision and outcomes. Each can be skipped and is shown as missing.
- AC-2 The owner can edit them later. Each change is versioned: one revision per save, recording who changed it.
- AC-3 No agent path writes an instance outcome without the owner's action. Fields start empty. A suggested mission starter is applied only when the owner clicks it.
- AC-4 A skipped or incomplete direction leaves exactly one Needs-you item, linking to the panel. It never blocks setup. Existing installs see it too.

BI-8AB6B4F7 acceptance, quoted from the item:

- AC-1 The org context bundle and prompt block carry the vision and instance outcomes.
- AC-2 evaluate_org_business_decision (WWWD) and evaluate_profession_decision (WSID) read them as context. So does principle_decide (WWMD) when the decision is scoped to an organization. Each records on its ledger which outcomes it read.
- AC-3 When none are recorded, the decision says so. Nothing is invented.

- Decision: decomposed
- Parent: BI-916216E7
- Receipt: `cmvsnpupc04c901msp9me6df4`
- Mapping: capture-and-edit -> BI-916216E7
- Mapping: decision-layers-read -> BI-8AB6B4F7
- Dependencies: BI-8AB6B4F7 depends on BI-916216E7.
