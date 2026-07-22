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
| `SubmitButton` | Primary action with a first-class pending state (`aria-busy` + `InlineBusy`); disables to prevent double-submit. |
| `FormStatus` | Settled outcome region — error is assertive (`role="alert"`), success is polite (`role="status"` + `aria-live`). |
| `ConsequenceNotice` | Risk-proportional consequence copy behind progressive disclosure (native `<details>`): what changes, who's affected, reversibility, recovery. |

**The contract each field must satisfy:**
1. **Stable name + id-label wiring** — every control has a `name` and an `id` bound to a real `<label htmlFor>` (so `getByLabelText`, click-to-focus, and AT all work).
2. **Accessible label** — visible label text, never placeholder-as-label.
3. **Required/optional state** — exposed visibly (`*` / `(optional)`) **and** to AT (`aria-required`, the native `required` attribute, and an SR-only "(required)").
4. **Correct `autocomplete`** — `username`/`email` for identifiers, `current-password` for sign-in, `new-password` for set/confirm/temporary passwords, `name`/`tel`, and the `address-line1`/`address-level1`/`address-level2`/`postal-code`/`country` tokens for addresses. Use `off` only for admin-entered credentials for *another* user, and one-off date/time pickers.
5. **Inline validation** — field-level errors set `aria-invalid` and render through `FormField`'s described `role="alert"` region, not only a form-level banner.

**Mutating submits** show pending → success/failure through `SubmitButton` + `FormStatus` (never a silent recolor or a bare text swap).

**Sensitive actions** (create/deactivate a user, reset a password, change pay) carry a `ConsequenceNotice` that answers what changes, who/what is affected, whether it can be undone, and the recovery path — kept behind progressive disclosure so a non-technical owner sees one plain summary line, not a wall of text.

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

**Accessibility (required):**
- Mark the region being updated with `aria-busy="true"`.
- Announce status text with `role="status"` + `aria-live="polite"` (the primitives do this; a bare `role="status"` in the codebase usually wraps a *result/error* region, which is a different use).
- Motion is honored against the OS **Reduce Motion** preference via a global `@media (prefers-reduced-motion: reduce)` block in `globals.css` — spinners and shimmer fall back to a static, legible resting state. Don't reintroduce unguarded keyframe animations.

**Rollout:** the primitives are the canonical replacement for the hand-rolled indicators catalogued across the portal; migrate opportunistically and when touching a surface. A CI ratchet — `scripts/check-no-hand-rolled-loading.mjs`, run by the repo guard loop — freezes the remaining sites at a per-file baseline and **fails any new `animate-spin`/`animate-pulse` outside `components/ui/`** (migrate a surface, then `--update` to retighten). Semantic **status dots** (e.g. a pulsing health indicator) are state, not loading, and are out of this pattern — but still inherit the reduced-motion guard.

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

### Enforcement points

- **Documentation site (today):** the `/business-types/` generator scores every page's business-facing copy at build time, warns when a page exceeds the target, writes `_readability-report.md`, and prints the grade in each page footer. Architecture and standards sections are excluded by design.
- **Generated copy (platform) — implemented (BI-8F8C5F28):** when an AI coworker on a customer-copy surface (marketing, storefront) writes external copy, it is held to the org's readability target. The target is an **operator-adjustable policy stored on the existing `PlatformConfig` key/value table (key `content_readability_policy`) and set from the existing `/admin/settings` page — no new table or admin surface**. It is resolved at runtime (`apps/web/lib/readability/policy.ts`, honouring a per-archetype `marketingSkillRules.readingLevel` override) and injected into the coworker's prompt at **Block 5** of the assembler (`apps/web/lib/tak/prompt-assembler.ts`). The shared Flesch–Kincaid scorer + tiered-policy types live in `@dpf/validators` (`packages/validators/src/readability.ts`).
- **Operator visibility (planned):** showing the live Flesch–Kincaid score to the operator while they edit marketing/storefront copy, the way a word processor does. The shared scorer (`@dpf/validators`) is ready; surfacing it in the copy editor is the remaining step.

### Coworker rule

Every coworker that writes customer-facing copy (marketing-specialist and peers) must:
- write external/business copy at the org's target reading level (default high school, grade ≤ 9);
- use short sentences, active voice, and familiar words; avoid jargon in business copy;
- keep architecture and standards copy precise even when it reads higher;
- check the Flesch–Kincaid grade before publishing.

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

## Archetype-scoped customer marketing surfaces

Customer marketing artifacts (campaign briefs, proof prompts, asset tasks, drafts) **must** speak in the vocabulary of the organization's own business archetype. A restaurant markets covers, bookings, menus, seasonal/quiet-period offers, and reviews — never software-platform artifacts such as "Build Studio", "technical founders", or "AI workflow". Early bootstrap and imported/test data can leak DPF-internal vocabulary into a customer surface; the platform detects and contains that leak deterministically (BI-CC580161).

Contract (implemented in `apps/web/lib/marketing/archetype-fit.ts` + `apps/web/lib/marketing/fit-guard.ts`):

1. **Two finding kinds.** `platform-leak` (software-platform / DPF-internal terms foreign to every customer archetype) is a hard **block**; `off-archetype` (vocabulary distinctive to a *different* customer archetype than the active one) is a **warn** — cross-sell copy can be legitimate, so confirm before sending.
2. **First viewport = one next decision.** `/customer/marketing` opens with a single archetype-scoped owner decision (`buildMarketingOwnerDecision`), phrased in the owner's own metrics (covers, booking fill rate, no-show rate for food-hospitality), not internal delivery jargon.
3. **Guard at every release point.** Approve, Send email, and Publish to LinkedIn show a fit warning/block and are disabled on a `block`. The block is also enforced server-side (`guardDraftArchetypeFit`, `publishApprovedDraft`) so a client bypass cannot reach a real audience.
4. **Saved leaks stay visible but inert.** Blocked artifacts render an "Imported / test data — blocked from publish" badge on the strategy and campaigns pages and count toward `importedTestCount`; they are never silently hidden and never publishable.

Archetype vocabulary is sourced from the archetype-category marketing playbooks in `apps/web/lib/tak/marketing-playbooks.ts`; the active category comes from `StorefrontConfig.archetype.category`.
