# Plan — Roster import via the Universal Grid (load → edit → save)

**Date:** 2026-06-22
**Epic:** EP-ONBOARDING-INTAKE · **BI:** BI-9B1E403D (relates EP-GRID-WORKBOOKS)
**Spec:** [`docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md`](../specs/2026-06-20-onboarding-intake-derivation-design.md) §7.3
**Supersedes:** the read-only roster preview shipped in P4 slice 1 (BI-C024582F).
**Status:** built (this PR); live UX verification to follow.

## Goal

Founder `/goal`: make the in-platform **Universal Grid** (Smartsheet-like, EP-GRID-WORKBOOKS) the **load → edit → save** surface for the roster import. Upload XLS/CSV → it opens as an **editable grid** → the operator fixes rows → **"Create employees from this sheet"** → `EmployeeProfile`. Adds XLSX for free; unifies on one mapping contract. Verify live with a multi-employee load and confirm the grid editor works well.

## Why (the gap this closes)

Two half-flows existed: the grid loaded+edited XLSX but committed to a *generic* `WorkbookTable`; my roster importer committed to typed `EmployeeProfile` but only offered a *read-only* preview (CSV-only). This converges them — the grid is the edit surface, a new bridge commits the edited rows to employees.

## Change set (maximal reuse)

| File | Change |
|------|--------|
| `apps/web/lib/onboarding/roster-from-grid.ts` | **new pure bridge:** `cellToString` (any grid `CellValue` → string) + `mapGridToEmployees(columns, rows)` → reuses the existing `mapRosterToEmployees`. Column **names** drive role detection, so renaming a header *in the grid* still works. |
| `apps/web/lib/onboarding/roster-from-grid.test.ts` | unit tests (cell flattening, grid→employees, edited headers). |
| `apps/web/lib/actions/workbooks.ts` | `createEmployeesFromTableAction(tableId)` — read the table (`getTableSchema` + paged `queryRows`) → `mapGridToEmployees` → `importRoster`. **CSV/TSV support** added to `importSheetAction` (was XLSX-only). `startTeamSheetImportAction` — find-or-create a "Team" workbook + import + return ids (onboarding entry). |
| `apps/web/components/workbooks/ImportSheetButton.tsx` | accept `.csv/.tsv` + relabel "Import sheet". |
| `apps/web/components/workbooks/CreateEmployeesButton.tsx` | **new:** the commit affordance, shown on custom tables. |
| `apps/web/app/(shell)/workbooks/[workbookId]/page.tsx` | render `CreateEmployeesButton` next to Add-column for `dataSource==="custom"` tables. |
| `apps/web/components/admin/RosterImport.tsx` | **rewritten:** upload → `startTeamSheetImportAction` → redirect to the grid (replaces the read-only preview). |

Reuses unchanged: the live grid editor (`CustomTableAdapter.updateCells`), `mapRosterToEmployees`, `importRoster` (dedup by work email, fail-soft), the grid import inference (`inferTableFromSheet`).

## Flow

1. Onboarding "Add your team" (business-context page) → upload CSV/XLSX → lands in the **Team** workbook as an editable grid.
2. Operator edits in the grid (fix names, emails, headers) — the real Universal Grid.
3. "Create employees from this sheet" → `EmployeeProfile` rows (dedup, fail-soft) + a result summary.

The grid edit **is** the review step; nothing is created until the explicit click.

## Notes / scope

- **No new routes** — all libs/components/action edits, so the route-manifest gate doesn't fire.
- The P4-slice-1 `/api/onboarding/roster*` API handlers are now UI-orphaned but remain valid endpoints (left to avoid manifest churn; flagged for later cleanup).
- Identity baseline only (name/email/phone/start date); title/department are visible in the grid, FK resolution is a follow-on.
- **Verification:** unit (`roster-from-grid.test.ts`, plus the existing roster tests). **Live UX (the goal's bar):** deploy via self-upgrade, then load a multi-row roster, edit a cell in the grid, click create, and confirm `EmployeeProfile` rows + that the grid editor works well.

## UX-Fit

Optional accelerator; progressive disclosure (upload appears as one optional control; the grid is the platform's existing edit surface; commit is one plain button). No numeric/raw inputs, no native dialogs, theme tokens. `UX-Fit-Decision:` attested in the PR.
