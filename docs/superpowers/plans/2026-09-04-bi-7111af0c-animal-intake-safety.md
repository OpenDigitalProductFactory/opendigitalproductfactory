---
status: active
---

# BI-7111AF0C — Deliver animal intake safety and placement readiness

| Field | Value |
| --- | --- |
| Backlog item | `BI-7111AF0C` |
| Epic | `EP-5102F494` |
| Workroom | `WC-0F9E29BA` |
| Branch | `feat/bi-7111af0c-intake-pipeline` |
| Decision | `DI-F289DBB51DCB` |
| Design | `docs/superpowers/specs/2026-09-04-bi-7111af0c-animal-intake-safety-design.md` |

## Outcome

Deliver one safe intake workflow from arrival through placement readiness.
Reuse canonical animal identity, custody, care intake, care evidence,
appointments, and Resource occupancy. Do not create animal-only copies of the
care substrate, and do not activate the hybrid scheduling fallback unless a
verified invariant failure returns through architecture review.

## Atomic coverage

All rows map to `BI-7111AF0C`. They are one non-independently shippable safety
workflow: intake without capacity, evidence, holds, or operator reach would
create a false sense of readiness.

| Key | Deliverable | Requirements | Contracts | Flow | Acceptance verification | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| `animal-intake-policy` | Versioned rescue intake requirements and typed evidence rules | `OBJ-INTAKE-002`, `OBJ-INTAKE-004`, `OBJ-INTAKE-005`, `OBJ-INTAKE-007` | `CareIntakePacket.requirementSnapshot`, `CareRecord`, activation profile | `intake-policy-resolution` | `AC-INTAKE-002`, `AC-INTAKE-003`, `AC-INTAKE-005`, `AC-INTAKE-010` | — |
| `animal-subject-care-adapter` | Organization-owned animal adapter for intake, records, and appointments | `OBJ-INTAKE-004`, `OBJ-INTAKE-007` | `animal-profile:<id>`, `CareIntakePacket`, `CareRecord`, `CareAppointment` | `animal-care-write` | `AC-INTAKE-005`, `AC-INTAKE-006`, `AC-INTAKE-008`, `AC-INTAKE-010` | `animal-intake-policy` |
| `animal-intake-transaction` | Atomic identity, custody, packet, and housing admission | `OBJ-INTAKE-001`, `OBJ-INTAKE-002`, `OBJ-INTAKE-003` | `AnimalIntakeCommand`, `AnimalProfile`, custody ledger, occupancy service | `animal-arrival` | `AC-INTAKE-001`, `AC-INTAKE-002`, `AC-INTAKE-003`, `AC-INTAKE-004`, `AC-INTAKE-008` | `animal-subject-care-adapter`, `BI-D2A51B36` |
| `placement-readiness` | Pure evidence-based readiness projection and authorized stage transition | `OBJ-INTAKE-002`, `OBJ-INTAKE-004`, `OBJ-INTAKE-005` | `IntakeReadiness`, custody transition | `intake-to-placement-ready` | `AC-INTAKE-003`, `AC-INTAKE-005`, `AC-INTAKE-006`, `AC-INTAKE-007`, `AC-INTAKE-008` | `animal-intake-transaction` |
| `intake-operator-surface` | Accessible create, queue, evidence, hold, housing, and readiness controls | `OBJ-INTAKE-001`, `OBJ-INTAKE-002`, `OBJ-INTAKE-003`, `OBJ-INTAKE-004`, `OBJ-INTAKE-005`, `OBJ-INTAKE-006` | `/workspace/rescue/intake`, `AnimalIntakeProjection` | `operator-intake-workflow` | `AC-INTAKE-001`, `AC-INTAKE-004`, `AC-INTAKE-007`, `AC-INTAKE-009` | `placement-readiness` |
| `protected-delivery` | Schema/RLS, regression, UX, exact-tree, and protected-merge verification | all objectives | `DCO`, `protected-merge`, `EP-5102F494.single-PR-per-item` | `protected-delivery` | `AC-INTAKE-001` through `AC-INTAKE-011` | all preceding rows |

## Phase 1 — immutable design and readiness

1. Commit this design and plan with DCO and required gate-answer trailers.
2. Publish the branch normally and reconcile `WC-0F9E29BA` to the exact commit.
3. Record research against the immutable design artifact, comparing the cited
   shelter standard and open-source implementations.
4. Obtain independent design-spec, specification approval/objective baseline,
   and architecture review receipts.
5. Record atomic plan coverage and independent plan review.

No product edit begins before initiative-readiness allows implementation.

## Phase 2 — Red: policy, evidence, and readiness

Add failing tests for:

- every canonical intake source and requirement snapshot;
- typed animal evidence and rejection of a legacy boolean as procedure proof;
- hold activation/release and jurisdiction-neutral duration;
- readiness reasons for missing evidence, exception, hold, recovery, housing,
  custody, appointment, and correction conflicts;
- animal appointments preserving recall, overbooking authority, preparation,
  recovery, and resource footprints;
- patient behavior and tenant isolation remaining unchanged.

Observe each focused failure for the intended missing behavior before Green.

## Phase 3 — Green: animal subject adapter and access policy

Create a small animal-welfare repository under
`apps/web/lib/animal-welfare/` that:

- resolves `AnimalProfile` ownership before any care-root write;
- builds `animal-profile:<id>` subject references server-side;
- validates versioned requirement and `CareRecord.detail` shapes;
- creates and reads `CareIntakePacket`, `CareRecord`, and `CareAppointment`
  through shared subject-neutral helpers;
- retains the deployed patient repository contract.

If RLS needs an animal-subject policy, update the Prisma schema and generate a
migration from `packages/db`. Amend only the generated policy SQL and validate
the complete migration chain.

## Phase 4 — Red/Green: atomic intake orchestration

Add transaction tests for new and existing animal intake, duplicate microchip,
idempotency, conflicting active custody, capacity unavailable, incompatible or
cross-tenant housing, rollback, and concurrent acceptance.

Implement one serializable service that creates/resolves the identity, opens
custody, appends its event, creates the packet, and allocates housing. Reuse the
canonical housing command from `BI-D2A51B36`; do not duplicate allocation logic.

Expose a narrow authenticated command adapter. Derive organization, profile,
roles, requirement version, and capacity policy on the server.

## Phase 5 — Red/Green: placement readiness and transitions

Implement a pure, bounded readiness evaluator over the intake packet, custody,
care evidence, appointments/recovery, exceptions, corrections, and housing.
Return stable blocker codes and supporting record ids.

Add one authorized stage-transition command that locks the same facts, reruns
the evaluator, and appends the custody event only on a ready verdict. Do not
persist a second readiness boolean.

## Phase 6 — Green: rescue intake operator workflow

Extend `/workspace/rescue/intake` rather than adding navigation:

- new intake form with identity, source, arrival, hold, and available housing;
- bounded status queue and deterministic sort;
- checklist/evidence detail with procedure and recovery state;
- hold release and placement-ready actions with authority explanations;
- explicit empty, blocked, validation, conflict, permission, retry, and settled
  success states.

Keep the server projection bounded and paginated. Do not project unrestricted
medical notes or foster addresses into the queue.

## Phase 7 — verification and protected delivery

1. Run focused animal-welfare, care, scheduling, occupancy, route/action, and
   component tests plus web and packages/db typecheck.
2. Generate the migration from `packages/db` if required; validate migrations
   against a fresh database and prove rollback disposition.
3. Run blast-radius review, prose/style guards, and
   `pnpm run pregate:preflight`.
4. Regenerate route, audience, shell, purpose, docs/index, architecture, Prisma,
   and other change-impact artifacts required by the final path set.
5. Obtain a governed preview lease. Verify the complete workflow with an
   authenticated operator at desktop and 390px, including full/capacity refusal,
   hold, missing care evidence, procedure recovery, ready transition, and error
   recovery. Record UX-fit evidence.
6. Obtain fresh exact-tree semantic/architecture review and run governed
   exact-tree local CI.
7. Push normally, open one DCO-signed PR for `BI-7111AF0C`, include seed-fit in
   the PR body, enable squash auto-merge, read bot findings, run PR health, and
   verify protected merge.
8. Verify the deployed intake workflow, record delivery and objective outcomes,
   complete the BI/Workroom, then continue to `BI-5A25EC37`.

## Risk and rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Animal incorrectly becomes placeable | pure fail-closed evaluator plus locked transition | disable transition; retain evidence/history |
| Intake exceeds capacity | same-transaction Resource lock and occupancy command | disable create command; no partial custody row |
| Patient RLS broadens | separate animal ownership resolution and regression tests | revert animal policy; patient policy unchanged |
| Legal rules are hard-coded | versioned profile requirement and human-authorized hold release | supersede policy version; retain prior snapshot |
| Duplicate care substrate | architecture guard against animal-only intake/appointment/procedure tables | remove adapter without data migration |
| Sensitive detail leaks | bounded purpose-specific projection | remove unsafe field; canonical record remains |

## Gate answers and seed disposition

- The design grounding is `DI-F289DBB51DCB`; the primary generalized substrate
  path is selected and the hybrid fallback is inactive.
- Prisma migrations, if needed, are generated from `packages/db`.
- No work from later epic items is bundled into this PR.
- Seed fit belongs only in the PR body: update profile requirement definitions,
  not demo operational data.
- The implementation commit records the grounding, docs impact, and process
  spine in trailers.
