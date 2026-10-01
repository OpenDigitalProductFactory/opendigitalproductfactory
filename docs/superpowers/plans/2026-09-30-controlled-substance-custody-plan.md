---
status: active
---

# Controlled-Substance Custody — Implementation Plan

**Spec:** [2026-09-30-controlled-substance-custody-design.md](../specs/2026-09-30-controlled-substance-custody-design.md)
**Epic:** `EP-CSC-CUSTODY`
**Branch:** `feat/controlled-substance-custody`

## Deliverables

Each row is independently shippable and maps to one backlog item.

| Key | BI | Deliverable | Depends on | Requirements | Verification |
|---|---|---|---|---|---|
| D1 | `BI-CSC-001` | Schema, enums, migration (append-only triggers, CHECKs, RLS), TS unions | — | Spec §§4–5 | AC-CSC-001; migration applies; schema validate; typecheck |
| D2 | `BI-CSC-002` | Ledger policy and recording command, hash-chain verifier | D1 | Spec §6 | AC-CSC-002, AC-CSC-003; vitest |
| D3 | `BI-CSC-003` | Count policy and recording command; variance opens discrepancy | D1, D2 | Spec §7 | AC-CSC-004; vitest |
| D4 | `BI-CSC-004` | Discrepancy lifecycle and loss/theft clock | D1 | Spec §8 | AC-CSC-005; vitest |
| D5 | `BI-CSC-005` | Portal UI: register, movement entry with witness, count sheet, discrepancy queue | D2–D4 | Spec §9 | UX gate on leased preview |
| D6 | `BI-CSC-006` | Advise-safe coworker read tools (balances, due counts, open cases) | D2–D4 | Spec §9 | MCP parity tests |
| D7 | `BI-CSC-007` | Jurisdiction overlays: state annual inventory and wastage-witness rules (Illinois first), UK register profile | D2, D3 | Spec §§2, 9 | Policy tests per profile |
| D8 | `BI-CSC-008` | Archetype composition: veterinary encounter and procedure wiring (veterinary design pharmacy slice), shelter euthanasia (`BI-6AA4C3BD`), medical-practice dispensing, staffing key-holder presence, seeded count obligations | D2–D5 | Spec §9 | Archetype acceptance journeys |
| D9 | `BI-CSC-009` | Ordering (Form 222/CSOS), EPCS, PDMP integration evaluation | D2 | Spec §9 | Tool evaluation, then design |
| D10 | `BI-CSC-010` | Licensed SME and compliance validation of rule text before customer-facing claims | D2–D4 | Spec §2 claim boundary | Signed review record |

This branch delivers **D1–D4**. D5–D10 stay open with their dependencies.

## D1 — Schema

- New file `packages/db/prisma/schema/controlled-substances.prisma`, with back-relations
  added to `Organization`, `Principal`, `OrganizationLicenseRecord`, `PersonLicenseRecord`,
  `CareLocation`, `PatientProfile` and `AnimalProfile`.
- Enums: `ControlledSubstanceSchedule`, `ControlledSubstanceUnit`,
  `ControlledSubstanceHandlerScope`, `ControlledSubstanceMovementKind`,
  `ControlledSubstanceCountKind`, `ControlledSubstanceCountTiming`,
  `ControlledSubstanceCountMethod`, `ControlledSubstanceDiscrepancyClass`,
  `ControlledSubstanceDiscrepancyStatus`. Their TS unions go in
  `packages/db/src/controlled-substance-enums.ts`, with a parity test against the schema.
- Migration `20260930120000_controlled_substance_custody`: tables, FKs (Restrict),
  CHECKs, triggers refusing UPDATE and DELETE on movement, count and count line, and org
  RLS (FORCE) on all seven tables.

## D2 — Ledger

- `apps/web/lib/controlled-substances/ledger-policy.ts` (pure): `evaluateMovement`,
  `hashMovement`, `verifyChain`.
- `apps/web/lib/controlled-substances/ledger-repository.ts`: `recordControlledMovement`
  (serializable tx, RLS context, advisory lock keyed by register and product, reads the
  last movement and the handler authorizations, evaluates, inserts) and
  `reverseControlledMovement`.

## D3 — Counts

- `count-policy.ts` (pure): `requiredCountMethod`, `evaluateCountLine`, `nextCountDue`.
- `count-repository.ts`: `recordControlledCount`, which writes the count and its lines,
  then opens one discrepancy per non-zero variance.

## D4 — Discrepancies

- `discrepancy-policy.ts` (pure): transition table, `lossReportingDeadlines`
  (business-day aware), `evaluateDiscrepancyClose`.

## Gates

Unit tests (`vitest run` on the new files), `pnpm --filter web typecheck`,
`@dpf/db` typecheck, the schema-validate and source policy guards. The migration must
apply cleanly, verified through the canonical runtime or shared lease. If it cannot run,
it is reported as not run. There is no UI in D1–D4, so the UX gate does not apply.
