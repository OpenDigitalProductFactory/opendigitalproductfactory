# Platform Usability Standards

Living reference for all UI development. All developers and AI agents must follow these standards when creating or reviewing UI code.

## Color System

Every UI component uses CSS custom properties for all color roles. These properties are set by the branding system via `buildBrandingStyleTag()` and fall back to defaults in `globals.css`.

| Variable | Purpose | Example |
|----------|---------|---------|
| `--dpf-bg` | Page background | `background: var(--dpf-bg)` |
| `--dpf-surface-1` | Cards, panels, inputs | `background: var(--dpf-surface-1)` |
| `--dpf-surface-2` | Secondary surfaces | `background: var(--dpf-surface-2)` |
| `--dpf-text` | Primary text | `color: var(--dpf-text)` |
| `--dpf-accent` | Interactive elements, links | `color: var(--dpf-accent)` |
| `--dpf-muted` | Secondary text, placeholders | `color: var(--dpf-muted)` |
| `--dpf-border` | Borders, dividers | `border-color: var(--dpf-border)` |
| `--dpf-font-body` | Body font family | `font-family: var(--dpf-font-body)` |
| `--dpf-font-heading` | Heading font family | `font-family: var(--dpf-font-heading)` |

## Design Token Scales (L0)

Color is only one axis. Spacing, type, elevation, radius and motion are tokens too, and they
generate **real Tailwind utilities**. Source of truth is `apps/web/design/tokens.json` (DTCG);
`apps/web/app/tokens.generated.css` is generated from it and must never be hand-edited —
run `pnpm --filter web build:design-tokens` and commit. A freshness gate enforces this
(EP-UX-SYSTEM spec §6 L0, BI-CD81FF7C).

| Axis | Utilities | Notes |
|------|-----------|-------|
| Spacing | `p-dpf-*`, `gap-dpf-*`, `m-dpf-*` — `2xs` 4px → `3xl` 64px | 4-pt progression. Tailwind's numeric `p-4` stays legal; the semantic steps are what the UX budgets measure against. |
| Type | `text-dpf-caption\|body\|body-lg\|title\|heading\|display` | **Each step carries its own line-height.** Do not stack `text-3xl font-bold leading-tight` to invent a hierarchy step. |
| Weight | `font-dpf-regular\|medium\|semibold` | |
| Elevation | `shadow-dpf-xs\|sm\|md\|lg` | |
| Radius | `rounded-dpf-sm\|md\|lg\|xl` | `rounded-dpf-md` matches the form-control radius. |
| Motion | `animate-dpf-fade-in\|slide-up\|scale-in`, `ease-dpf-standard\|out\|in` | Durations are **properties, not utilities** — Tailwind v4 has no `--duration-*` namespace. Use `duration-[var(--dpf-duration-base)]`. |
| Density | `--dpf-density-control\|row\|gap` | A context, not a utility: set `data-dpf-density="compact"` on a container and controls inside re-resolve. |

Colour utilities (`bg-dpf-accent`, `text-dpf-muted`, `border-dpf-border`) alias the `--dpf-*`
properties above, so dark mode and runtime branding overrides still win. The pre-existing
`bg-[var(--dpf-accent)]` spelling remains legal and resolves to the identical property; the
generated utilities are canonical for new code.

**Off-scale values are ratcheted.** `scripts/check-style-drift.mjs` carries a second
per-file baseline (`token-drift-baseline.json`) alongside the hardcoded-hex one, covering
three axes: arbitrary font sizes (`text-[13px]` — the type scale carries line-heights),
spacing off the 4-pt grid (`p-[7px]`; on-grid arbitrary values like `p-[8px]` stay legal),
and off-token motion (`duration-[250ms]`, inline `animate-[…]`). Same contract as the hex
ratchet: a file may never gain off-scale values, and the baseline shrinks as surfaces are
migrated — no blind mass-rewrite. Current debt is overwhelmingly type (~1,962 arbitrary
sizes, most of them the sub-legible `text-[9px]/[10px]/[11px]` the live UX audit flagged);
spacing and motion are already near-clean. For a genuine exception add a trailing
`// style-drift-allow`; after migrating a file, run `--update` to retighten.

> **Why this is enforced by a compile test, not a lint.** The platform previously shipped a
> `tailwind.config.ts` declaring `shadow-dpf-*` that Tailwind v4 never read (CSS-first setup, no
> `@config` directive), leaving ~50 call sites styling themselves with class names that resolved
> to nothing. `apps/web/design/tokens-utilities.test.ts` runs the real compiler and asserts each
> promised utility emits a rule, so a token under a namespace v4 does not expose fails loudly.

## UX Budgets (L2)

Every owner-facing surface has a measurable budget. `apps/web/lib/ux-budget/` is the one
module that defines them, and the same numbers feed three consumers: the guidance agents
read, the CI checkers, and the migration league table. Intended shell per route is
**derived** from the existing audience/destination-kind registry
(`lib/navigation/route-audience.ts`) — there is no second hand-kept route list.

| Axis | Budgeted as |
|------|-------------|
| Default-visible words | Words on arrival, **collapsed disclosure excised** |
| Lead band | Presence + word count of `data-dpf-lead` |
| Primary actions | `data-dpf-primary-action` (falls back to submit buttons) |
| Visible fields | Fields the owner must fill (not hidden/submit inputs) |
| Choices per control | Largest single control's option count (Hick's law) |
| Sub-legible controls | Always 0 — WCAG 2.2 AA 2.5.8 |
| Reading level | Flesch–Kincaid tier per shell |
| Deferred detail | Above a per-shell word threshold the surface **must** use disclosure |
| Primary action reachable | A marked primary action (`data-dpf-primary-action` / `data-owner-first-next-action`) may not be buried behind a collapsed disclosure on action shells (cockpit/detail/settings/form) |

**Lead-band adoption is presence-positive.** Adding a compliant `data-dpf-lead` to a
pre-existing route is a retrofit improvement, not a regression, even though the measured
lead-band word count rises from zero. The ratchet catches removal of an established lead
band; absolute `maxLeadBandWords` budgets still report overlong copy and block net-new
routes.

**Long option lists use a searchable picker, not a native closed select.** Timezones,
regions, currencies, integrations, industries, archetypes and service-line catalogs must
render only the current value on arrival, then expose a bounded searchable list after the
owner opens the picker. Use `SearchableSelect` for static closed sets so the route sweep
does not count hundreds of hidden choices as default-visible text or `choices-per-control`
debt.

### Design grounding

- Existing specs/plans reviewed: `BI-0EC59231`, EP-UX-SYSTEM UX budget guidance in this document, and `docs/architecture/build-gate-runbook.md`.
- Current code substrate reviewed: `apps/web/components/admin/OperatingHoursEditor.tsx`, `apps/web/components/storefront-admin/ServiceLinesPanel.tsx`, `apps/web/components/ui/form/SelectField.tsx`, and `apps/web/lib/ux-budget/measure.ts`.
- Source of truth: long static catalogs belong in `SearchableSelect`; route-level choice pressure is measured by `maxChoicesPerControl`.
- Decision: replace long native owner-facing selects with a closed searchable picker, keep common/current choices first, and preserve native form posting through a hidden value field.

**Hiding the primary action is a regression the word budgets cannot see.** Moving a
trigger behind an "Advanced" collapse *reduces* the default-visible word and control
counts, so the volume budgets read it as an improvement. The reachability axis is the
answer: a primary action that is marked but not present in the default-visible scope
fails — blocking on net-new routes, and caught by the ratchet's `buriedPrimaryAction`
axis (a 0→1 transition) on pre-existing ones, so a route that was *already* buried does
not fail an unrelated PR while a route you *just* buried does. This is why marking the
one action a surface most wants the user to take is worth doing: the gate can then tell
"tucked away detail" (good) from "hid the main verb" (bad). The self-upgrade trigger
regression is the motivating case: the initial fix (BI-D77BF495) force-opened the
Advanced disclosure in both nav modes as a safe increment; the completed fix extracted
the trigger into its own `SelfUpgradeTriggerControl` component and co-located it inside
`OwnerReleaseCard`, so the Advanced section (history/ledgers/logs only) could go back to
collapsing by default in Simple mode without re-burying the primary action.

**Progressive disclosure is rewarded, never taxed.** Measurement excises
`<details>` without `open`, `[data-dpf-disclosure]` without `open`, `[hidden]` and
`[aria-hidden="true"]` — matching close tags by depth, so nested markup cannot leak a
collapsed subtree back into the measured scope. Moving professional detail behind
disclosure is the sanctioned fix for a surface over budget, and the budget measures it
that way.

### Operator finding actionability

An alert, exception, conflict, or finding is not operator work merely because a detector emitted
it. It enters an action queue only when it is **open, specific, evidenced, owned, executable, and
verifiable**. Resolved, withdrawn, context-free, and already-executed internal records remain
available in audit history; they do not become cards asking a person to act.

Navigation and action are different contracts. A detail link may explain a historical record. An
action must carry one complete label + destination + promised-outcome object, and the destination
must expose the control or owning workflow capable of producing that outcome. A dead-end button
such as “Resolve” or “De-conflict” on an audit-only detail is a failed workflow, not acceptable
empty-state copy. The canonical contract and benchmark evidence are in
[`decision-governance-surface-redesign-design.md` §10](superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md#10-addendum-2026-08-08-bi-76eedee8-findings-must-carry-an-achievable-outcome).

The same contract governs a coworker conversation. A filed backlog id is an action whose promised
outcome is "someone will pick this up later"; handing one to an operator who asked for help *now*,
without first trying to reach a colleague who could move the work, is the conversational form of the
dead-end button. Coworkers are a team that can reach each other directly, so filing is the last rung
of an ordered ladder — re-route to the specialist who owns the area, consult a peer for one bounded
question, convene the parties in a workroom, and only then file, naming who was tried. The contract
is assembled into every coworker's prompt from `platform-identity/escalation-ladder`
(`apps/web/lib/tak/escalation-ladder.ts`), and a turn that files without attempting a rung above it
offers the escalation instead of ending the thread. When no single specialist obviously owns a
question — it spans areas, or is contested — the ladder points at the standing coordinator: the
specialist hands the thread to the COO, says so plainly ("I've brought this to our COO to route"),
and the COO routes, convenes, and holds the thread until someone owns it. Coordination is visible;
the byline never becomes "the COO decided" — recommendations keep their own attribution and approval
stays with the human (`platform-identity/coordinator-contract`). Full rationale in
[`coworker-escalation-ladder-design.md`](superpowers/specs/2026-08-15-coworker-escalation-ladder-design.md).

Repeated detector or consultation events are audit occurrences, not automatically separate units
of operator work. A queue must project one item per deterministic work identity, disclose how many
occurrences it represents, and make one successful disposition clear every still-open occurrence
with that identity atomically. Do not use opaque semantic similarity to propagate a person's
business ruling; near-matches require an explicit review or merge decision.

**Enforcement splits by route age, not by axis.**

- **Net-new routes — absolute budgets block from day one.** A pure ratchet freezes
  whatever ships first, so a brand-new route would become its own baseline and could be
  born as a wall of text without ever failing. Legacy debt earns a ratchet; new code has
  no legacy excuse.
- **Pre-existing routes — the same budgets are advisory**, reported on the PR, plus the
  regression ratchet. Retrofitting absolutes onto them keeps the flip contract.
- **WCAG and the deferred-detail rule block regardless of age** — those are standards
  and structure, not calibration.

Text-mass numbers are **platform-owned calibration, not science** — no evidence
validates words-per-screen against user outcomes. They are versioned in
`lib/ux-budget/budgets.ts` for a founder to adjust from lived review, and they only move
downward. (Visual/perceptual metrics are a different case — those *are* validated and
ratchet independently.)

Pre-migration routes carry recorded exemptions (`next-action-marker`, `lead-band`) until
they adopt their shell. The exemption list is checked in and shrinks visibly as the
redesign lands — debt recorded, never hidden.

**The gate that enforces this is the route budget sweep** (`.github/workflows/ux-route-sweep.yml`).
It boots the real portal against an ephemeral database, drives every static page route with
Playwright, and measures the **served DOM** — not an SSR string, which has neither client
components nor honest visibility. Computed-invisible nodes are pruned in the page first, so
a `hidden md:block` utility is resolved by the browser that actually applied it.

Three enforcement modes, decided by `lib/ux-budget/ratchet.ts`:

1. **Pre-existing route → regression ratchet.** A changed route may not exceed its own
   frozen baseline on words, controls, fields, choices, sub-legible controls or axe
   violations, and may not remove an established lead band. Existing debt is reported
   every run but never blocks a PR that did not make it worse. That restraint is
   deliberate: a gate that fails unrelated PRs on legacy debt forces a blind mass-rewrite
   and gets switched off.
2. **Net-new route → absolute budgets block.** No baseline to hide behind.
3. **Structure → the ARIA snapshot must not drift.** Heading levels, landmarks and
   accessible names, as a diffable YAML projection. "This PR flattened the h2/h3 structure
   into a run of divs" is now visible in review.

Arming it is one mechanical step. The baseline ships `bootstrapped: false`, so the sweep
reports without blocking until a measured baseline is committed:

```bash
pnpm --filter web ux:sweep -- --update-baseline
```

The routes present at that moment become "pre-existing"; anything added later is net-new
and must meet the absolutes. axe runs in the same job — necessary, never sufficient; its
green is not a claim that a surface is accessible.

## Contrast Requirements

All color pairs must meet WCAG 2.2 Level AA minimum contrast ratios:

| Element Type | Minimum Ratio | Standard |
|---|---|---|
| Body text on any background | 4.5:1 | WCAG 2.2 AA |
| Secondary/muted text on any background | 4.5:1 | WCAG 2.2 AA |
| Interactive text (links, buttons) on background | 4.5:1 | WCAG 2.2 AA |
| UI components (borders, focus rings) on background | 3:1 | WCAG 2.2 AA |
| Status indicators on background | 3:1 | WCAG 2.2 AA |

**Enforcement points:**
- **Derivation time:** `ensureContrast()` nudges colors during token generation
- **Save time:** `validateTokenContrast()` checks all configurable pairs and auto-corrects violations before database write

## Form Elements

All `<input>`, `<select>`, `<textarea>` elements receive a baseline via `@layer components` in `globals.css`:
- **Focus:** 2px solid outline using `--dpf-accent`, offset 2px
- **Placeholder:** Uses `--dpf-muted` (guaranteed 4.5:1 contrast)
- **Disabled:** `opacity: 0.5; cursor: not-allowed`
- **Active/focused:** Border color changes to `--dpf-accent`

## User-facing form contract (mandatory)

Every user-facing form — public/customer auth, storefront setup, employee HR/pay,
admin, and archetype booking/intake — composes the shared primitives in
[`apps/web/components/ui/form/`](../apps/web/components/ui/form/) so field wiring
and action feedback are consistent for non-technical owners and assistive
technology. Do **not** hand-roll a label/input pair, a submit spinner, or a bespoke
consequence banner; a form that re-implements these is a defect (BI-8E74C749).

**Primitives** (import from `@/components/ui/form`):

| Primitive | Responsibility |
|---|---|
| `FormField` | Labeled-control wrapper (render-prop). Owns `<label htmlFor>`↔`id`, required/optional marker, `aria-required`, `aria-invalid`, hint + error wired via `aria-describedby`, and `role="alert"` on the error. |
| `TextField` / `EmailField` / `SelectField` / `TextareaField` / `CheckboxField` | Typed controls built on `FormField`. `EmailField` also normalizes on blur via `EmailInput`. |
| `SearchableSelect` | Static closed-set picker for long catalogs. Renders a single combobox value on arrival, hides the option corpus until opened/searched, and posts the selected value through a hidden field when `name` is provided. |
| `SubmitButton` | Primary action with a first-class pending state (`aria-busy` + `InlineBusy`); disables to prevent double-submit. |
| `FormStatus` | Settled outcome region — error is assertive (`role="alert"`), success is polite (`role="status"` + `aria-live`). |
| `ConsequenceNotice` | Risk-proportional consequence copy behind progressive disclosure (native `<details>`): what changes, who's affected, reversibility, recovery. |

**The contract each field must satisfy:**
1. **Stable name + id-label wiring** — every control has a `name` and an `id` bound to a real `<label htmlFor>` (so `getByLabelText`, click-to-focus, and AT all work).
2. **Accessible label** — visible label text, never placeholder-as-label.
3. **Required/optional state** — exposed visibly (`*` / `(optional)`) **and** to AT (`aria-required`, the native `required` attribute, and an SR-only "(required)").
4. **Correct `autocomplete`** — `username`/`email` for identifiers, `current-password` for sign-in, `new-password` for set/confirm/temporary passwords, `name`/`tel`, and the `address-line1`/`address-level1`/`address-level2`/`postal-code`/`country` tokens for addresses. Use `off` only for admin-entered credentials for *another* user, and one-off date/time pickers.
5. **Inline validation** — field-level errors set `aria-invalid` and render through `FormField`'s described `role="alert"` region, not only a form-level banner.
6. **Semantic projection attributes** — typed primitives forward applicable native control attributes, including `data-surface-node-id`, to the actual `<input>` or `<select>`. Put Authorized Surface identifiers on the interactive control—not a wrapper—so DOM/accessibility conformance can prove that the rendered UX is a projection of the governed semantic contract.

**Mutating submits** show pending → success/failure through `SubmitButton` + `FormStatus` (never a silent recolor or a bare text swap).

**Sensitive actions** (create/deactivate a user, reset a password, change pay) carry a `ConsequenceNotice` that answers what changes, who/what is affected, whether it can be undone, and the recovery path — kept behind progressive disclosure so a non-technical owner sees one plain summary line, not a wall of text.

## Preference/tuning save-state contract (BI-20716EA4)

Every owner-visible preference or AI-coworker tuning control (a toggle, a level picker, a debounced drag control) that persists via an async write — as distinct from the *form* contract above, which covers a full submit — composes the shared save-state primitive instead of a hand-rolled `.catch(() => {})`. A live usability audit of `/coworker-decisions/proactivity` found dozens of controls with no visible `Saving`, `Saved`, `Failed`, or `Retry` language; the owner had no way to know whether a click persisted.

**Primitives:**

| Primitive | Location | Responsibility |
|---|---|---|
| `useSaveState<T>` | `apps/web/lib/shared/use-save-state.ts` | Optimistic value + `idle \| pending \| saved \| failed` status, debounce, auto-revert-to-last-confirmed on failure, `retry()`/`revert()`, flush-on-unmount and flush-on-subject-switch (`resetKey`) so a pending debounced edit is never silently dropped, and a `beforeunload` warning while a save is queued. |
| `useAsyncAction<T>` | same module | Built on `useSaveState` — the one-shot variant for a submit-style action with no ongoing optimistic value (e.g. `FeedbackForm`). |
| `SaveStateIndicator` | `apps/web/components/ui/SaveStateIndicator.tsx` | The visible region: pending (polite), saved (polite), or failed (`role="alert"`) with Retry/Revert buttons at the `SHELL_TAP_TARGET_CLASS` (≥44px) tap size. Renders close to the control it describes, not a global toast. |

**The contract:** a failed save must never be swallowed — the owner gets a plain-language reason plus Retry; the optimistic UI snaps back to the last confirmed value automatically on failure so the control never shows an unsaved value as if it persisted. Applied to `ProactivityRosterList` (per-row), `CoworkerPriorityDock` (posture + proactivity, both debounced/immediate), and `FeedbackForm` (submit pending/failed/retry). See `apps/web/lib/shared/use-save-state.test.ts` for the state-machine contract and each component's `*.test.tsx` for the integration coverage.

## Prohibited Patterns

These patterns are NOT allowed in component code:

| Pattern | Replacement |
|---------|-------------|
| `text-white` | `text-[var(--dpf-text)]` |
| `text-black` | `text-[var(--dpf-text)]` |
| `bg-white` | `bg-[var(--dpf-surface-1)]` |
| `bg-black` | `bg-[var(--dpf-bg)]` |
| `color: "#ffffff"` | `color: "var(--dpf-text)"` |
| `background: "#000000"` | `background: "var(--dpf-bg)"` |
| Any hardcoded hex for bg/text/border/accent/muted | Use the corresponding `var(--dpf-*)` |
| Hand-rolled `animate-spin` / `animate-pulse` loading indicator | `ui/Spinner`, `ui/Skeleton`, `ui/ProgressBar`, or `ui/InlineBusy` (see *Async Activity & Loading States*) |

## Allowed Hex Usage

Literal hex values are permitted ONLY for:
1. **Status colors** referenced from `ThemeTokens.states` (success, warning, error, info)
2. **SVG brand marks** and third-party logos (Google, Apple, etc.)
3. **Third-party component overrides** where CSS variables cannot be injected

## Component Checklist

Before submitting a component, verify:
- [ ] All backgrounds use `var(--dpf-bg)`, `var(--dpf-surface-1)`, or `var(--dpf-surface-2)`
- [ ] All text uses `var(--dpf-text)` or `var(--dpf-muted)`
- [ ] All borders use `var(--dpf-border)`
- [ ] All interactive elements use `var(--dpf-accent)`
- [ ] No `text-white`, `text-black`, `bg-white`, or `bg-black` Tailwind classes
- [ ] No inline hex colors for token roles
- [ ] Component renders correctly in both light and dark mode (toggle OS preference to verify)
- [ ] Every asynchronous action shows a visible activity indicator from `ui/` — no hand-rolled `animate-spin`/`animate-pulse` (see *Async Activity & Loading States*)

## Async Activity & Loading States

Every asynchronous action MUST show a visible, consistent activity indicator. A state change with no motion — a button whose only feedback is swapped text, a panel that sits blank while data loads — reads as "nothing is happening" and is a defect. Use the shared primitives in `apps/web/components/ui/`; never hand-roll `animate-spin` / `animate-pulse`.

**Which indicator, when** (converged from Nielsen Norman Group, Shopify Polaris, GitHub Primer, Vercel Geist, IBM Carbon):

| Situation | Indicator | Primitive |
|---|---|---|
| < ~0.5s (or LCP < 800ms) | **Nothing** — a placeholder that flashes is perceptually worse than empty space | — |
| A short/unknown-duration action you triggered (button submit, inline fetch, ~0.5–10s) | Spinner + status label | `Spinner`, or `InlineBusy` inside a button |
| Async data filling a **known layout** (panels, cards, lists, tables) | Skeleton (shape-of-content + shimmer) — best perceived performance | `Skeleton`, `SkeletonText` |
| Determinate work where the total is known (uploads, multi-step, builds) | Progress bar | `ProgressBar` |
| Never | Skeleton **and** spinner together — pick one | — |

**Refreshing existing content:** keep the current content visible and dimmed (`opacity`) with the region marked `aria-busy`, and show the spinner on the trigger. Don't blank out good content to show a placeholder.

**Process evidence:** use the shared `workroomStage` status domain. `passed`
requires a verification verdict; `observed` records an event without asserting
success; `unknown` lacks proof; `cancelled` is separate from completion. A terminal
room state does not prove that earlier steps passed. Keep intended definitions,
observed execution, and any simulation distinct, with a keyboard-accessible list
and step inspector. Do not turn stage position into an estimated percentage.

**Accessibility (required):**
- Mark the region being updated with `aria-busy="true"`.
- Announce status text with `role="status"` + `aria-live="polite"` (the primitives do this; a bare `role="status"` in the codebase usually wraps a *result/error* region, which is a different use).
- Motion is honored against the OS **Reduce Motion** preference via a global `@media (prefers-reduced-motion: reduce)` block in `globals.css` — spinners and shimmer fall back to a static, legible resting state. Don't reintroduce unguarded keyframe animations.

**Rollout:** the primitives are the canonical replacement for the hand-rolled indicators catalogued across the portal; migrate opportunistically and when touching a surface. A CI ratchet — `scripts/check-no-hand-rolled-loading.mjs`, run by the repo guard loop — freezes the remaining sites at a per-file baseline and **fails any new `animate-spin`/`animate-pulse` outside `components/ui/`** (migrate a surface, then `--update` to retighten). Semantic **status dots** (e.g. a pulsing health indicator) are state, not loading, and are out of this pattern — but still inherit the reduced-motion guard.

## Multi-source data states

A dashboard or report that combines providers must expose the truth of each source rather than collapse every outcome into “no data.” Its read model carries source identity, freshness or observation time, and one of `loading`, `ready`, `empty`, `stale`, or `failed`; a partial result is the aggregate condition where at least one source is usable and at least one is stale or failed.

| Condition | Presentation | Recovery |
|---|---|---|
| All requested sources completed with zero records | `EmptyState` with the applied scope and time window | Change filters or connect a source |
| One or more sources failed and none is usable | Error `Alert`/`AlertBox`; never an empty state | Plain-language reason and manual Retry |
| Some sources are usable | Keep usable facts visible; show a prominent partial-data notice and per-source status/freshness | Retry only the failed sources |
| A previously successful source is beyond its declared freshness window | Keep the last confirmed value visibly marked stale | Refresh without blanking the confirmed value |
| Capability is unsupported, stubbed, or not connected | Name that condition; do not present fabricated zeroes | Link to the owning connection or capability path when actionable |

The owning interaction defines and tests its latency budget; there is no platform-wide “5 seconds means timeout” constant that is honest for every provider and report. A user-facing request has a bounded deadline. Automatic retry is allowed once only for a safe, idempotent transient failure and remains inside that deadline; rate-limit guidance is respected. Otherwise recovery is explicit and operator-triggered. Background work shows durable progress instead of holding a page request open.

State changes use one persistent status region with `aria-live="polite"` so assistive technology announces recovery and repeated failures without recreating the live region; an immediate blocking failure uses the shared assertive alert primitive. This follows [WAI-ARIA live-region guidance](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA19). Color is never the sole partial/stale/error indicator.

## Progressive Disclosure

Choose the disclosure construct by the relationship between its summary and
content. Do not hand-roll a new expand/collapse dialect inside a feature.

| Need | Canonical construct |
|---|---|
| Preview the first rows of one long list | `CollapsibleList` |
| Reveal subordinate detail for one record among peer records | `ExpandableCard` |
| Hide one short, secondary piece of prose or advanced help | Native `<details>` |
| Preserve a large detail workspace while the list remains visible | Purpose-built drawer |
| Support linking, history, or a full record workflow | Dedicated detail route |
| Choose ONE option out of more than the shell's choice budget | `SearchableSelect` |

`ExpandableCard` follows the WAI-ARIA accordion/disclosure contract: a native
button is the only control inside the heading; the button exposes
`aria-expanded` and `aria-controls`; the panel is labelled by the trigger; and a
visible chevron communicates state. Enter and Space work through native button
semantics. Opening inline detail does not move focus. The same summary trigger
closes it, so a separate remote "Close" action must not be added.

Render record identity and summary metadata once. Loading and recoverable error
states belong inside the opened panel while its summary remains stable. Lists of
peer records should normally allow one open item at a time unless research shows
that operators need side-by-side comparison.

### Choice load is disclosure too (BI-D6135B88)

A control that offers more options than its shell's `maxChoicesPerControl` budget
(20 on `detail`/`list`, 12 on `cockpit`) has pushed an unresolved decision onto the
reader — Hick's law, and the axis `lib/ux-budget/measure.ts` measures. Deferring
that decision is the same doctrine as deferring text: `SearchableSelect`
(`components/ui/report-kit/`) lets the reader **type** what they are looking for
instead of scrolling a dropdown, while every option stays reachable.

This is a picker, not truncation, and the distinction matters: a control that
silently drops options fails the completeness expectation even when it measures
well. State the count, keep every option resolvable, and report an unresolved
entry inline rather than selecting nothing.

`/platform/audit/authority` was the motivating case — a 94-option agent select
against a budget of 20, on the estate's worst route by default-visible words.

## Readability & Plain Language

Business-facing copy must be understandable by the people who **run** a business, not only the people who build the platform. The platform — and its own marketing — holds business copy to a **high-school reading level**, measured with the **Flesch–Kincaid** tests that word processors like Microsoft Word report. Plain language is a precondition for mass adoption, and a marketing requirement when reaching a non-technical audience.

### Audience tiers

Reading level is tiered by audience — match the copy to the reader. Do **not** flatten everything to one level:

| Audience / surface | Target | Flesch–Kincaid grade | Why |
|---|---|---|---|
| Marketing & external (storefront, campaigns, landing copy) | High school | ≤ 9 | Reaches the widest audience; the basis for mass acceptance |
| A specific archetype / business page | High school | ≤ 9 | Operators read these to run the business |
| Reseller / partner / integrator material | College | ≤ 13 | Partners and MSPs want robust detail and fit |
| Architecture & standards (TAK, GAID, system design) | Highest | no cap | Precision for architects and standards reviewers outranks simplicity |

Two metrics, both Flesch–Kincaid:
- **Grade Level** — approximate U.S. school grade; target ≤ 9 for business copy.
- **Reading Ease** — 0–100, higher is easier; aim ≥ 55 for business copy ("plain English").

### Prose is not a user interface (BI-0ED0F6B3)

Flesch–Kincaid assumes **paragraphs**. It divides words by sentences, and it finds
sentences by looking for full stops. That holds for a storefront page, a campaign, a
business-type write-up — and it does not hold for a rendered product screen, which is
headings, table cells, button labels and nav items, almost none of which are
punctuated.

Score a whole screen as one string and every label on it collapses into a single
enormous "sentence". Words-per-sentence explodes and the grade climbs for copy that
carries no difficulty at all. Measured: the same fifteen words at the same 1.4
syllables per word score **grade 6.8** unpunctuated and **grade 1.5** with a stop
after each label. Identical vocabulary; the only variable is punctuation the screen
had no reason to carry. On real surfaces the same mechanism put 185 of 201 routes
over their cap, `/platform/identity/agents` at grade 377 — an arithmetic impossibility
for prose, and the clearest sign the number was measuring layout rather than language.

So there are **two scorers**, and picking the wrong one is a defect:

| Input | Function | What it reads |
|---|---|---|
| Prose — storefront copy, campaigns, docs, a marketing snippet | `analyzeReadability` | full Flesch–Kincaid: sentence length **and** word difficulty |
| A rendered UI surface | `analyzeUiReadability` | **word difficulty alone** |

Flesch–Kincaid is `0.39 × words-per-sentence + 11.8 × syllables-per-word − 15.59`.
Its first term assumes the text has sentences. A screen does not, so for UI surfaces
that term is **dropped** rather than repaired:

```
UI grade = 11.8 × syllables-per-word − 15.59
```

The coefficients are FK's own, so the scale and the existing caps keep their meaning.
Nothing about punctuation appears in the formula, which makes the measure
punctuation-independent **by construction** — a fact about the arithmetic, not a
property a test has to keep re-checking. Two consequences worth naming:

- **No arrangement of full stops can move the grade.** Not one stop per label, not
  none at all, not the entire screen as a single run. Under the old measure that
  choice was worth five grades.
- **Dense words still fail.** A screen of one-word labels reading *Infrastructure /
  Optimization / Administrative / Documentation* fails the high-school cap; *Date /
  Route / Miles* passes. Plain product copy runs about 1.76 syllables per word and
  scores 5.2; genuinely dense operator prose runs about 3.57 and scores 26.5.

**What this deliberately gives up.** Sentence length is a real readability signal and
this measure is blind to it — one 60-word paragraph of simple words grades the same as
those words in six sentences. That signal has its own home: `check-prose-lint` flags any
copy sentence over 25 words on its `longSentences` axis, scoring one sentence at a time
where the term is meaningful. Splitting the two concerns is what lets each be honest —
word difficulty here, sentence length there, neither pretending to measure the other.

The UI reading grade is also scored over the route's own `<main>` rather than the
shared shell. Chrome is identical on every route and was diluting all of them equally.
Word and control budgets keep their whole-surface scope — the shell's header and rail
are part of what the owner meets on arrival.

### Enforcement points

- **Documentation site (today):** the `/business-types/` generator scores every page's business-facing copy at build time, warns when a page exceeds the target, writes `_readability-report.md`, and prints the grade in each page footer. Architecture and standards sections are excluded by design.
- **Generated copy (platform) — implemented (BI-8F8C5F28):** when an AI coworker on a customer-copy surface (marketing, storefront) writes external copy, it is held to the org's readability target. The target is an **operator-adjustable policy stored on the existing `PlatformConfig` key/value table (key `content_readability_policy`) and set from the existing `/admin/settings` page — no new table or admin surface**. It is resolved at runtime (`apps/web/lib/readability/policy.ts`, honouring a per-archetype `marketingSkillRules.readingLevel` override) and injected into the coworker's prompt at **Block 5** of the assembler (`apps/web/lib/tak/prompt-assembler.ts`). The shared Flesch–Kincaid scorer + tiered-policy types live in `@dpf/validators` (`packages/validators/src/readability.ts`).
- **Product screens (route sweep):** the UX route budget grades every page route's own
  copy with `analyzeUiReadability` against the tier in
  `apps/web/lib/ux-budget/budgets.ts`. Advisory on pre-existing routes, blocking on
  net-new ones. It is an absolute check, not a ratcheted axis, so it carries no entry
  in `route-budget-baseline.json`. **Every audience is held to its shell's tier** —
  the admin/builder college exception was withdrawn once the corrected measure showed
  every route that justified it clearing grade 9 (`/admin/graph-explorer` 11.1 → 3.4).
- **Operator visibility (planned):** showing the live Flesch–Kincaid score to the operator while they edit marketing/storefront copy, the way a word processor does. The shared scorer (`@dpf/validators`) is ready; surfacing it in the copy editor is the remaining step.

### Coworker rule

Every coworker that writes customer-facing copy (marketing-specialist and peers) must:
- write external/business copy at the org's target reading level (default high school, grade ≤ 9);
- use short sentences, active voice, and familiar words; avoid jargon in business copy;
- keep architecture and standards copy precise even when it reads higher;
- check the Flesch–Kincaid grade before publishing.

### Name the role, not the species (BI-F2EC4699)

User-facing copy names the **role** a person holds in the business. It never renders
`HITL`, `HITL T2`, `human-only`, or a bare oversight tier number to a user — those are
technical names for a real mechanism, not language a business owner can act on.

- **Oversight language comes from one module.** `apps/web/lib/workforce/oversight-copy.ts`
  is the single source of truth: **Employee only / Needs approval / Employee review /
  Runs on its own**, with colour resolved through the `employeeOversight` intent
  namespace in `apps/web/components/ui/report-kit/statusColors.ts`. Never declare a
  local tier→label or tier→colour map. Six components carried drifted ones — two with
  raw hex — before this rule existed.
- **Resolve the role in prose.** Use **employee** for a workforce member and **owner**
  for the accountable business decision-maker (see `apps/web/lib/owner-first/`). Reach
  for a neutral word ("people") only where the code genuinely does not know which — for
  example a principal count spanning employees *and* contractors. A blanket
  `human` → `employee` sweep is wrong: it labels the business owner an employee.
- **`human` stays correct in code.** Identifiers, comments, the `human` principal-kind
  enum (`callingPopulation`, principle `appliesTo`, `Principal.kind`), and the Prisma
  columns keep it, because there "human" is the accurate opposite of "agent".
- **`human-readable` is a different word.** Never include it in a vocabulary sweep.

This mirrors the "Agent" (technical principal kind) vs "AI coworker" (user-facing
workforce term) split from BI-08393602. Full rationale:
[plan](superpowers/plans/2026-07-29-employee-oversight-vocabulary.md).

## Common Shell Action-Result Contract

The common shell chrome that wraps every owner route (`apps/web/app/(shell)/layout.tsx` — header, Simple/Full rail, contextual help, feedback, health badge, coworker panel) must obey one action-result contract so non-technical owners can predict what a control does and see that it happened. Shared, testable pieces live in `apps/web/lib/shell/shell-action-contract.ts`; the design is in `docs/superpowers/specs/2026-07-22-shell-action-result-contract-design.md` (BI-9C0954D0).

| # | Rule | How to satisfy it |
|---|---|---|
| C1 | **Unique accessible target per region.** A control's accessible name must not collide with a different destination in the same shell. | The route-scoped help control is **"Help for this page"**; the global catalog nav item is **"All docs"**. Never ship two controls named `Docs`. |
| C2 | **Label matches result.** The visible/accessible label names the surface or state the click produces. | `Feedback` opens a feedback-labelled surface (`Send feedback`), not a generic assistant. Mode toggles name their outcome (`Switch to Simple view`). |
| C3 | **Visible result after click.** Every shell action produces a change the owner can perceive — navigation, a labelled popover, a pressed state, an `InlineBusy` pending affordance, or a `role="status"` announcement. A silent state change is a defect. | Sign out shows `Signing out…`; the mode toggle shows `Switching…` + a live-region announcement + a mode-explanation caption. |
| C4 | **Route-aware behavior.** Route-scoped controls resolve against the current route and say so. | Contextual help uses `buildContextualDocsHref(pathname)` and carries `sourceRoute`. |
| C5 | **Mobile tap-safe.** Interactive shell controls present a ≥44×44px hit area (WCAG 2.2 AA 2.5.8 Target Size Minimum). | Apply `SHELL_TAP_TARGET_CLASS` (`dpf-tap-target`, defined in `apps/web/app/globals.css`) to the control. |
| C6 | **Task before chrome.** Owner surfaces expose the route task ahead of global/internal chrome in reading order. | The shell renders a **Skip to main content** link as the first focusable element (targeting `#main-content`), and builder-flavored header chrome recedes in Simple mode. |

New shell controls, and edits to the existing ones, must be covered by the action-result smoke (`apps/web/components/shell/shell-action-result-contract.test.tsx`), which parameterises the contract across the owner routes.

## Archetype-scoped marketing content (BI-CC580161)

Customer marketing surfaces (`/customer/marketing`, `/customer/marketing/strategy`, `/customer/marketing/campaigns`) must speak in the language of the **organization's own business archetype**. A restaurant markets covers, bookings, menus, seasonal/quiet-period offers and reviews — never software-platform artifacts (Build Studio, technical founders, AI workflow, SaaS, the Digital Product Factory). Bootstrap and imported/test data can leak that vocabulary in; the platform detects and contains it.

### Fit engine (source of truth)

`apps/web/lib/marketing/archetype-fit.ts` — `assessArchetypeFit({ text, category })` returns a deterministic `{ severity: "ok" | "warn" | "block", blocked, findings, summary }`:

- **platform-leak → `block`.** Software-platform / DPF-internal terms are foreign to *every* customer archetype and can never be published. Blocked artifacts are badged **"Imported / test data — blocked from publish"** and cannot pass Approve, Send email, or Publish to LinkedIn.
- **off-archetype → `warn`.** Vocabulary distinctive to a *different* archetype (e.g. banking "APY", education "enrolment") surfaces a warning to confirm fit before sending; it does not hard-block, because cross-sell copy can be legitimate.
- The active archetype's own vocabulary never warns.

### Enforcement points

- **Server (authoritative):** `guardDraftArchetypeFit` blocks Approve (`actions.ts`) and `publishApprovedDraft` (`publish.ts`) blocks Publish/Send — client warnings alone are never trusted.
- **UI:** the approval queue, publish buttons, and saved campaign/asset artifacts (`/campaigns`) render the fit badge/notice and disable release on a hard block.
- **Drafter:** `draft-builder.ts` derives audience, tone, and CTA vocabulary from the archetype playbook (`lib/tak/marketing-playbooks.ts`) instead of a hardcoded software-founder voice, so generated copy is on-archetype by construction.

### First-viewport decision

`/customer/marketing` opens with **one** archetype-scoped next decision (`lib/marketing/next-decision.ts`, `buildMarketingOwnerDecision`) phrased in the owner's own terms and tied to the archetype's headline metric (e.g. booking fill rate, covers).

## Standards Referenced

- WCAG 2.2 (W3C Recommendation) — Level AA compliance
- EN 301 549 (European ICT Accessibility Standard)
- Section 508 (US Federal Accessibility)
- CSS Media Queries Level 5 (`prefers-color-scheme`)
- Flesch Reading Ease & Flesch–Kincaid Grade Level — the readability tests reported by common word processors (e.g. Microsoft Word)

## Operator identity and personalization

When greeting or addressing the operator in portal UI:

1. Prefer `User.displayName` / first name when present and human-looking.
2. Fall back to a derived first name from email local-part only when it is not a opaque id.
3. Never show a raw email as the primary greeting when a display name exists.
4. Do not invent personalization knobs the operator cannot see or control; keep defaults progressive (one warm greeting, not a form).

This is the operator-personalization pattern (displayName precedence → email fallback → human-name derivation) used by dashboard greeting work (BI-IMP-0FFB8D25).

## Operator queue deep links

Cockpit tiles, attention cards, and coworker handoffs that open an operator work queue **must** use a stable filtered-link contract so the same URL works from email, chat, MCP, and progressive-disclosure UI (BI-IMP-5DE1139F / IP-E254E).

1. **Canonical query params** — encode filters as stable, documented query keys (e.g. `?status=open&workType=bug&epic=EP-…`). Prefer closed enums already used by the backlog/MCP surface; do not invent one-off keys per page.
2. **Deterministic section anchors** — when the page has bands (NEEDS-YOU, queue, detail), use stable `#section-id` anchors that match `id=` on the real DOM (not screenshot coordinates).
3. **Server-readable filters** — the list must apply the same filters from the URL on first paint (SSR or first client read of `searchParams`). Do not require a click-only path that loses the deep link.
4. **Graceful no-JS** — the URL alone must land on a useful view; optional client-side highlight/scroll is enhancement only.
5. **No coordinate deep links** — never deep-link via x/y click targets or ephemeral row indexes; use semantic ids (`BI-*`, `FB-*`, `WC-*`).

When adding a new operator queue, document its query keys next to the route (or in the page's report-kit `FilterBar`) so cockpit cards and `record_execution_evidence` links can reuse them.
