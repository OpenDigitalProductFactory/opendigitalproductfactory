# Plan — Onboarding Intake P4: document lane (employee-roster CSV, slice 1)

**Date:** 2026-06-22
**Epic:** EP-ONBOARDING-INTAKE · **BI:** BI-C024582F
**Spec:** [`docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md`](../specs/2026-06-20-onboarding-intake-derivation-design.md) §7.3
**Status:** roster CSV slice shipped (this PR); other document types sequenced below.

## Goal

The "employees entered quickly" lane (founder's literal ask): upload an employee-roster CSV → parse → **preview/confirm** → create `EmployeeProfile` rows. Rippling-style one-roster-many-records. Built **backend-first** on the live file-parser substrate, and kept on **existing routes** so it doesn't collide with the in-flight nav refactor.

## Fit with the nav-coherence refactor (deliberate)

Read `2026-06-21-portal-navigation-coherence-operator-console-design.md`. The new IA makes navigation a governed surface (P6 SysML extractor + **P7 inventory gate live on main**: a new page-route orphan fails CI). To stay clear of that while it churns:

- **No new page route.** The control lives on the existing `/storefront/settings/business` page (next to `BusinessDocumentUpload`), which is already in the nav. The two new routes are **API route handlers** (`/api/onboarding/roster*`), which the P7 gate explicitly ignores ("API route handlers never carry nav").
- A dedicated HR/team home is where this relocates *after* the nav convergence settles — noted, not built now.

## Change set

| File | Role |
|------|------|
| `apps/web/lib/onboarding/roster-import.ts` | **pure** core: `parseDelimitedGrid` (uncapped CSV/TSV — `parseCsv` samples 50, a roster needs all rows), `detectRosterMapping` (fuzzy header→role), `mapRosterToEmployees` (row→proposed employee, name derivation, email/date validation, in-file dedup). No DB, no AI — deterministic + fully tested. |
| `apps/web/lib/onboarding/roster-import.test.ts` | mapper + grid + detection unit tests. |
| `apps/web/lib/onboarding/roster-import-actions.ts` | `importRoster(confirmed, db?)` — create `EmployeeProfile` rows; dedup by work email vs existing; **fail-soft per row**; injectable client for tests. |
| `apps/web/lib/onboarding/roster-import-actions.test.ts` | persistence tests (dedup skip, fail-soft, intra-batch dupes, name-only). |
| `apps/web/app/api/onboarding/roster/route.ts` | POST CSV → preview (proposed employees). CSV/TSV only this slice. |
| `apps/web/app/api/onboarding/roster/import/route.ts` | POST confirmed rows → `importRoster`. |
| `apps/web/components/admin/RosterImport.tsx` | upload → preview table (name/email/role/notes) → **confirm** → result. Theme tokens, no native dialogs. |
| `apps/web/components/admin/BusinessContextForm.tsx` | render `<RosterImport />` next to the existing document upload. |

## Safety / scope guards

- **Confirm before create:** nothing is written until the operator reviews the preview and submits (matches the spec's stage→confirm→commit; the QuickBooks ADRs' integrate-before-replace ethos).
- **Identity baseline only:** persists name / work email / phone / start date. Detected **title + department** are shown for confirmation but their FK wiring (`Position`/`Department` lookup-or-create) is a follow-on — keeps the create clean and the slice shippable.
- **Dedup + fail-soft:** existing-email rows are skipped; one bad row never aborts the batch; row caps (2000) bound the payload.
- **Optional accelerator:** no required fields; failure never blocks setup (like `BusinessDocumentUpload`).

## UX-Fit

Optional upload + a read-only preview the operator confirms; no numeric/raw inputs, no native dialogs, theme tokens. Progressive disclosure: the preview only appears after a file is chosen, and import is one plain button. `UX-Fit-Decision:` attested in the PR.

## Verification

Unit (the verifiable core in a source-only worktree): `roster-import.test.ts` + `roster-import-actions.test.ts`. Compile/build run in CI. Live UX (upload → confirm → employees created) verified on the canonical install after deploy.

## Sequenced (remaining P4)

- **XLSX direct** (currently CSV/TSV; `parseXlsx` samples 50 rows so a full-fidelity path needs an uncapped reader).
- **Formation-packet fan-out** (formation doc / EIN letter / prior-year return → `Organization` legal name + EIN, `OrganizationLicenseProfile`, `OrganizationTaxProfile`) — the document-extraction half of §7.3.
- **Department/Position FK resolution** for imported employees (lookup-or-create).
