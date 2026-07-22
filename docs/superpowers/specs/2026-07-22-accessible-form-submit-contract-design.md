# Accessible form submit contract (BI-8E74C749)

**Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up)
**Status:** implemented
**Surface:** `apps/web` — user-facing forms (public/customer auth, storefront setup, employee HR/pay, admin, archetype booking/intake)

## Problem

A 2026-07-22 compact browser audit found a repeated pattern across customer,
owner, and admin pages: forms render visually, but the field structure and the
action-consequence contract are inconsistent for non-technical owners and
assistive technology. Concretely: `/portal/sign-in` and
`/s/digital-product-factory/sign-in` fields lacked `name`, accessible labels, and
password `autocomplete`; `/s/.../sign-up` did not mark the name field required and
passwords lacked `autocomplete`; `/storefront/settings/business` (dense 15-field
setup) had many missing names and no required-state contract; `/employee` HR/pay
and `/admin` Create-user exposed no required-state and no consequence/undo
language for sensitive controls.

Root cause: **no shared form primitive existed.** Every form hand-rolled its own
label wiring and `inputClasses`/`labelClasses` constants, so the accessible-name,
required-state, `autocomplete`, validation, submit-feedback, and consequence-copy
decisions were re-made (and dropped) per form.

## Design grounding

- **Source of truth:** `docs/platform-usability-standards.md` (Form Elements +
  the new "User-facing form contract" section) and AGENTS.md §12 (theme-aware
  styling, no native dialogs, progressive disclosure) / §17 (hide complexity from
  layman users).
- **Substrate check:** no `FormField`/`LabeledInput` primitive existed
  (grep + code-graph). Existing input-only primitives (`EmailInput`, `PhoneInput`,
  `InlineBusy`, `Dialog`) are composed, not replaced. This **extends** the
  usability standard and **creates** one shared primitive family under
  `apps/web/components/ui/form/`, mirroring the existing report-kit pattern
  ("compose a shared palette, never hand-roll").
- **Decision:** extend the standard + add primitives; no new data model, route, or
  migration. Progressive disclosure keeps consequence detail out of the default
  view, so this **lowers** cognitive load rather than adding controls.

## Research & benchmarking

- **WCAG 2.2 AA / WAI-ARIA APG** — label association, `aria-required`,
  `aria-invalid`, `aria-describedby` error wiring, live-region announcements.
- **HTML `autocomplete` token spec (WHATWG)** — `username`, `current-password`,
  `new-password`, `tel`, and the `address-*` token family.
- **GOV.UK Design System** (error summary + per-field error, one question per
  thing) and **Shopify Polaris** (progressive disclosure of consequential
  settings) — adopted the field-level `role="alert"` error and the disclosure of
  consequence detail; rejected a modal-per-action confirm for low/medium-risk
  saves as too heavy for a non-technical owner.

## Primitives (`apps/web/components/ui/form/`)

`FormField` (render-prop wrapper owning label↔id, required/optional, aria-*,
described hint + `role="alert"` error), `TextField`, `EmailField`, `SelectField`,
`TextareaField`, `CheckboxField`, `SubmitButton` (pending via `InlineBusy` +
`aria-busy`), `FormStatus` (assertive error / polite success), and
`ConsequenceNotice` (what / who / reversibility / recovery behind a native
`<details>`). Ids come from `useId()` so same-named fields never collide. All
colors resolve through `--dpf-*` tokens.

## Applied surfaces

| Route | Component |
|---|---|
| `/portal/sign-in`, `/s/[slug]/sign-in` | `SignInForm` |
| `/s/[slug]/sign-up` | `SignUpForm` |
| `/storefront/settings/business` | `BusinessContextForm` (surgical: names + autocomplete + announced submit) |
| `/employee` (HR/pay) | `CompensationPanel`, `HrUserLifecyclePanel` (+ ConsequenceNotice on deactivate) |
| `/admin` (Create user) | `AdminUserAccessPanel` (+ ConsequenceNotice on create + reset) |
| Restaurant / archetype booking | `BookingForm` |

## Tests

Route-level `*.test.tsx` co-located with each form assert the contract via
`getByLabelText` / `getByRole` (jsdom) — name/id-label wiring, `autocomplete`,
required/optional, inline validation, and consequence copy — plus a `FormField`
unit test (including same-name id-collision). `BusinessContextForm` reuses its
existing `renderToStaticMarkup` test, extended with name/autocomplete assertions.

## Non-goals

Not a full rewrite of every form in the portal; the remaining hand-rolled forms
(compliance, wiki, finance, edge-node admin) migrate opportunistically to the same
primitives when next touched.
