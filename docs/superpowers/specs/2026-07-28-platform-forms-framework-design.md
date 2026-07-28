# Platform Forms & Data-Entry Framework (form-kit)

- **Status:** first slice implemented
- **Date:** 2026-07-28
- **Epic:** `EP-UX-SYSTEM`
- **Backlog items:** `BI-C167C45E` (framework), `BI-69371E1A` (first consumer: Workbooks record modal)
- **Work Capsule:** `WC-624157ED`

## 1. Problem

DPF has a shared design-system vocabulary for *reporting* UX (`apps/web/components/ui/report-kit/`:
`StatusBadge`, `DataTable`, `StatCard`, `FilterBar`, `Chart`) but none for *editing* UX. There is no
form library dependency at all (`apps/web/package.json` carries no react-hook-form, Formik, or
TanStack Form), so every editing surface hand-rolls its own form. The result, reported live by the
operator against the Workbooks record modal (2026-07-27, BI-957970CA's record): edits commit
per-field on blur with no way to save-or-not-save, every field renders as one uniform single-line
input so long descriptions cannot be read, and there is no way to hide, reorder, or persist a field
layout — for everyone or just for yourself.

## 2. Decision

Introduce **form-kit**: a small DPF-native forms layer with three parts —

1. a pure **dirty-state kernel** (`apps/web/lib/form-kit/form-state.ts`): draft accumulates edits,
   explicit Save persists the dirty subset, Discard reverts; nothing commits on blur;
2. a deterministic **field→control registry** (`apps/web/lib/form-kit/field-controls.ts`): free
   text always gets an auto-growing editor, semantic tokens (url/email/phone) stay single-line
   with correct input types, the numeric family maps to number controls, complex/computed kinds
   stay read-only until promoted;
3. a **record-form composition** (`apps/web/components/ui/form-kit/RecordForm.tsx` +
   `AutoGrowTextarea.tsx`): label/control rows from `FormFieldSpec` metadata, a Save/Discard bar
   that appears only when dirty, and a disclosure section for fields the active layout hides.

Layout customization ("hide, move things around, save for all or just me") is **not** a new
persistence model. The first consumer proves the intended pattern: the form consumes the owning
surface's existing view state. Workbooks already has exactly the two scopes the operator asked
for — server-backed `WorkbookView` rows shared per custom table ("for all"), and localStorage
per-grid state on platform grids plus any user's own named view ("just for me") — so the record
form simply follows the active view's column order/visibility instead of inventing a parallel
layout store.

## 3. Research & Benchmarking

Compared before building (data/interaction models, not feature lists):

| Source | What it does | Adopted / rejected |
| --- | --- | --- |
| [react-hook-form](https://react-hook-form.com/) | Uncontrolled-input registration for perf; validation via resolver schemas (zod). | **Rejected as a dependency for v1.** Its core value (uncontrolled perf on large static typed forms, client-side schema validation) does not match DPF's shape: our forms are generated from dynamic field metadata and validation is server-owned (the Grid's `persistCell` dispatch; server actions). Adding it now adds supply-chain surface (EP-DEP-SOVEREIGNTY) for little leverage. Re-evaluate at the settings-forms adoption phase. |
| [TanStack Form](https://tanstack.com/form/latest) | Headless, framework-agnostic form state with fine-grained subscriptions. | Same verdict as react-hook-form for v1; its headless state shape informed the kernel's API (init/edit/commit/discard as pure transitions). |
| [RJSF (react-jsonschema-form)](https://rjsf-team.github.io/react-jsonschema-form/) | Generates whole forms from JSON Schema + uiSchema. | **Adopted the idea** (metadata-driven form generation — our `FormFieldSpec` plays the uiSchema role over Workbooks `ColumnDefinition`); rejected the library (schema dialect + widget theming would fight the DPF token system). |
| Airtable / Linear record forms | "Expand a row" record detail; one-row auto-growing text fields; explicit long-text editors; field visibility follows the view. | **Adopted**: auto-grow-from-one-row free text (`AutoGrowTextarea`), record form follows the active view's field order/visibility, hidden fields reachable but de-emphasized. |
| ServiceNow / Salesforce form layout editors | Admin-configured per-role form layouts stored server-side. | **Adopted the two-scope lesson** (org-shared default + personal override) but mapped it onto DPF's existing `WorkbookView` + localStorage view substrate instead of a new layout store; a dedicated layout editor is deferred until a surface proves the need. |
| Retool / Appsmith form builders | Drag-drop form composition bound to queries. | Rejected for now — builder-grade composition belongs to a later phase; v1 is metadata-driven rendering. |

## 4. Contract

```ts
// lib/form-kit/form-state.ts — pure kernel
initFormState(values) -> { baseline, draft }
withFieldEdit(state, fieldId, value)      // draft-only
dirtyFieldIds / isFormDirty / dirtyValues // Object.is + structural equality; null≡undefined
committed(state)   // after persistence succeeds
discarded(state)   // revert
rebaselined(state, fresh) // outside refresh never eats in-progress typing

// lib/form-kit/field-controls.ts
resolveControlKind(FormFieldSpec) -> longtext | text | number | checkbox | select | date | datetime | readonly
```

`RecordForm` owns rendering + the Save/Discard bar; the host owns persistence (receives only the
dirty subset), read-only rendering of its complex value kinds, and close-guarding (via
`onDirtyChange`, e.g. `confirmDialog` before closing a dirty modal — never a native dialog).

## 5. First consumer (BI-69371E1A)

`apps/web/components/workbooks/RecordDetailModal.tsx` is rebuilt on `RecordForm`:

- explicit Save (loops the dirty subset through the Grid's existing validated `persistCell`
  dispatch) and Discard; Escape/backdrop/✕ all pass a dirty-close `confirmDialog` guard;
- free text edits in `AutoGrowTextarea`; read-only values render wrapped (`whitespace-pre-wrap`),
  never truncated;
- the Grid now passes its view-ordered `visibleCols` as the default layout and the view's hidden
  columns behind the disclosure — so the existing hide/reorder/pin + named-view system (shared
  server views on custom tables, personal localStorage/named views elsewhere) *is* the modal's
  layout customization.

## 6. Adoption path (follow-up, not this slice)

1. Settings/admin CRUD forms adopt `RecordForm` (and the explicit-save model replaces ad hoc
   per-field auto-save) — file per-surface BIs as they are touched; re-evaluate react-hook-form if
   a surface needs client-side cross-field validation.
2. Promote complex kinds (reference, link, multi_select, attachment) from read-only to real
   form controls by reusing the Grid's existing editors.
3. A dedicated layout editor / per-user overrides beyond the view system only if a surface proves
   the view-state mapping insufficient (named invariant first, per `verify-substrate-before-proposing-new`).

## 7. Verification

- Unit: `lib/form-kit/form-state.test.ts`, `lib/form-kit/field-controls.test.ts`.
- Component (jsdom): `components/ui/form-kit/RecordForm.test.tsx` — no persist on blur; Save sends
  only the dirty subset; Discard reverts; hidden-field disclosure edits; read-only delegation.
- Gates: typecheck, production build, module-size/style guards via the shared local-CI sandbox
  (worktree-local runners are not runtime evidence).

## 8. Non-goals

- No new Prisma model, migration, or layout store; no external form library in v1; no change to
  grid in-cell editing; no builder UI.
