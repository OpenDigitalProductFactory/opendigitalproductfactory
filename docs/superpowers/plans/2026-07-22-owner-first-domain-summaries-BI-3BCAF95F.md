# BI-3BCAF95F — Owner-first daily work before CRM/HR/finance internals (plan)

**Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
**BI:** BI-3BCAF95F — Business domain pages need owner-first daily work before CRM, HR, and finance internals
**Date:** 2026-07-22
**Guiding outcome:** each major business-domain page opens with the owner's daily
job — what needs action today, why it matters, and the safest next action — in the
owner's own words, before any professional subsystem structure.

## Problem (live audit, 2026-07-22)

The domain pages still open as professional subsystem dashboards:

- `/workspace` leads with generic `Make this business decision?` cards while the
  `RESERVATIONS 0` rail chip and the funnel's `BOOKINGS 12 / INQUIRIES 1` never
  become a concrete owner action.
- `/customer` is framed as Accounts / Engagements / Pipeline / Quotes / Orders.
- `/customer/funnel` shows bookings/inquiries as analytics, not follow-up work.
- `/employee` opens with HR role cards (`HR-000`, HITL, SLA) before the directory.
- `/finance` opens with accountant lanes and the full AR/AP/reporting taxonomy.

## Design grounding

Extends the existing attention/workspace-home substrate; **creates one new
capability**: an owner-first summary layer that sits *in front of* the existing
domain surfaces. Source of truth for the projections is the same canonical data the
pages already load (storefront queues, CRM counts, timesheet periods, finance
aggregates) — no parallel record is persisted. Reuses `lib/navigation/nav-mode`
for Simple/Full density and the `food-hospitality` archetype category (the live
calibration archetype) for restaurant vocabulary.

Not touched: the global attention aggregator (`lib/attention/aggregate.ts`) — the
storefront reconciliation is rendered as an owner-first band *above* the
`OperatorCockpit` so it leads without re-plumbing the shared projector (which a
sibling BI, BI-348766E5, is already editing).

## What ships

**New shared module `lib/owner-first/`:**
- `vocabulary.ts` — `resolveOwnerVocabulary(category)` → restaurant vs neutral
  owner language (guest follow-up, reservations/orders/inquiries, service staff,
  bills/deposits/invoices, next service readiness).
- `domain-summary.ts` — pure builders (`buildCustomerOwnerSummary`,
  `buildEmployeeOwnerSummary`, `buildFinanceOwnerSummary`,
  `buildWorkspaceStorefrontSummary`) that project counts into an ordered
  `OwnerFirstSummary` (what / why / safest next action), urgent-first.
- `ux-audit.ts` — the owner-first UX checks (word count, link/button count, small
  controls, repeated generic decision labels, repeated `Technical detail`, and
  owner-first next-action presence) plus threshold evaluation.
- `context.ts` — one cached archetype read shared by the domain pages.

**New components `components/owner-first/`:**
- `OwnerFirstSummaryBand` — the band each page opens with; Simple mode drops the
  subhead and per-action "why" lines (reduces body content, not only the rail).
- `OwnerFirstDisclosure` — native `<details>` wrapper demoting professional
  structure behind progressive disclosure.
- `WorkspaceStorefrontAttention` — reconciles pending storefront
  reservations/orders/inquiries into the workspace before the cockpit residue.

**Page wiring:**
- `/workspace` — storefront band renders before `OperatorCockpit`.
- `/customer` — guest-follow-up band leads; RevenueCockpit / duplicates / grid /
  account list move behind an "All CRM detail" disclosure (hidden in Simple mode).
- `/customer/funnel` — guest-work band leads; pipeline + inbox breakdown hidden in
  Simple mode.
- `/employee` — heading corrected to "People"; service-readiness band leads; role
  governance (cards + HR lifecycle) moves to the bottom behind a "Role governance
  & access" disclosure (hidden in Simple mode).
- `/finance` — money-today band leads; finance lanes + accountant lane and the
  AR/AP/reporting taxonomy move behind disclosures (hidden in Simple mode).

## Verification

- `lib/owner-first/*.test.ts` — vocabulary, per-domain summary shape/ordering,
  restaurant vs neutral language, and the UX-check functions (including the live
  audit's overloaded-markup case).
- `components/owner-first/OwnerFirstSummary.test.tsx` — renders each domain band
  and asserts it passes every UX check, stamps an owner-first next action, uses no
  generic decision labels or repeated `Technical detail`, and that Simple mode
  reduces the rendered word count.
