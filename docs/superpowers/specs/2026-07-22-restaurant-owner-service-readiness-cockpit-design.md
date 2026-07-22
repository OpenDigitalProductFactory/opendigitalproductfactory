# Restaurant owner service-readiness cockpit — design

- **Date:** 2026-07-22
- **Epic:** EP-VERTICAL-FOOD-HOSPITALITY (primary), EP-UX-COGLOAD (contributing)
- **Backlog:** BI-075F731F (owner cockpit — primary), BI-353610C6 (storefront IA — partial: readiness surface). The owner-first reframing of the `/finance` and `/employee` **pages** (BI-3BCAF95F, BI-001FD798, BI-3326DA86) is **not** done here — that is owned by open PR #3412 (`owner-first/` framework). This slice contributes the equivalent finance-exception and staffing-readiness signals only as read rows inside the `/storefront` cockpit. BI-348766E5 reconciliation is owned by open PR #3403.
- **Status:** first slice (cockpit surface only)

## Problem

The Restaurant owner's first daily question — *"Are we ready for the next service period, and what exactly needs me?"* — has no single owner-readable answer. The live audit evidence on the six BIs above shows the work is scattered:

- `/workspace` leads with generic coworker decisions (`Approve this bill?`, `Make this business decision?`) while the restaurant rail says `RESERVATIONS 0` despite live Storefront bookings.
- `/storefront` is the "Venue Portal" owner surface but its dashboard exposes cross-industry service-line catalogs, not a readiness answer.
- `/finance` opens as accountant lanes (Revenue / Spend / Close / AR / AP / Procurement / Reports) instead of "what money needs you today".
- `/employee` (labelled "People") opens with platform role-governance cards (HITL / SLA) before staffing readiness.

## Design grounding

Specs/plans reviewed:
- `docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md` — the single-attention-surface rule on `/workspace` (`OperatorCockpit`, BI-8C3EB52C). A rival "needs-you" queue on `/workspace` is explicitly disallowed; this slice therefore anchors on `/storefront`, not `/workspace`.
- `docs/superpowers/specs/2026-05-16-ux-auditor-coworker-design.md` — the heuristic UX lenses (Fitts-law ≥44×44, generic-label repetition, technical-detail leakage) that the new UX checks encode as unit assertions.

Code substrate reviewed (extend, do not reinvent):
- `apps/web/lib/storefront/archetype-vocabulary.ts` — `getVocabulary("food-hospitality")` → Venue Portal / Guests / Staff / Reservations. All owner nouns come from here; **no hardcoded "restaurant" strings**.
- `apps/web/lib/navigation/nav-mode.ts` — `resolveNavModeFromCookie` / `isSimpleNavMode`; Simple mode = `worker`. The cockpit and domain leads read this so Simple mode reduces **body** content, not only the rail.
- `apps/web/lib/attention/owner-technical-detail.ts` — the established pattern of segregating technical fields into a progressive-disclosure block. The cockpit mirrors it (`technical[]`).
- `apps/web/app/(shell)/storefront/page.tsx` — already loads inquiry/booking/order counts, resource count, and operating-hours state; the cockpit mounts here as the lead panel for food-hospitality.

## Non-goals / deferred (owned by sibling open PRs — do not duplicate)

- **Workspace attention reconciliation** (BI-348766E5) → PR #3403. This slice does **not** add a storefront attention source or touch `apps/web/lib/attention/aggregate.ts` / `living-business-snapshot.ts`.
- **Storefront inbox row-specific actions / reservation-exception source** (BI-3DA1DFDC) → PR #3387. This slice does **not** touch `StorefrontInbox.tsx`.
- **Capacity legibility / `/storefront/tables` / resource vocabulary** (BI-7C95A586) → PR #3402. The cockpit's resource signal reports *configured-ness*, not a precise table model, and links to `/storefront/team` (present on `main`).
- **Owner-first reframing of the `/finance` and `/employee` pages** (BI-3BCAF95F, BI-001FD798, BI-3326DA86) → PR #3412 (`owner-first/` framework). This slice does **not** edit `finance/page.tsx` or `employee/page.tsx`; the cockpit surfaces finance-exception and staffing-readiness as read signals and links into those domains.

## Design

### 1. Pure read-model — `apps/web/lib/restaurant-cockpit/service-readiness.ts`

`deriveServiceReadiness(input): ServiceReadinessSummary`. DB-free, total, deterministic — the single place readiness copy and severity are decided, so it is fully unit-testable.

Five owner-readable signals, each `{ key, label, level, summary, detail?, href, actionLabel? }` with `level: "ready" | "attention" | "blocked"`:

1. **demand** — pending customer demand: new enquiries + unconfirmed reservations.
2. **service-load** — confirmed reservations for the next service period.
3. **tables** — bookable resource + operating-hours readiness (configured-ness only).
4. **staffing** — team set up on the roster (honest proxy from `ServiceProvider`; no fabricated coverage).
5. **finance** — money that needs the owner: supplier bills awaiting payment + overdue invoices.

The summary also carries `headline`, overall `level` (worst signal), `needsYouCount` (signals at attention/blocked), a single `nextAction` (most-urgent actionable, priority: confirm reservations → overdue invoices → bills to pay → reply to enquiries → add staff → set hours → "you're ready"), and a `technical[]` block (raw counts / source ids) for progressive disclosure.

Vocabulary is injected (`ReadinessVocabulary`), derived from `getVocabulary` — the model never hardcodes archetype nouns.

### 2. Async loader — `apps/web/lib/restaurant-cockpit/service-readiness-loader.ts`

Gathers the input from Prisma (bookings grouped by status, `new` inquiries, active `ServiceProvider` count, `Bill` awaiting payment, `overdue` `Invoice`, operating-hours flag) and calls the pure derive. Never throws — a load failure returns `null` and the page renders unchanged. Does **not** read the not-yet-merged `covers`/`dietary` columns (#3387).

### 3. Component — `apps/web/components/restaurant-cockpit/ServiceReadinessCockpit.tsx`

Server component. Renders the headline answer, the one exact next action as a ≥44px tap-safe primary control, and the five signals as owner-readable rows. Simple mode (`worker`) hides secondary `detail` lines and the technical block; Full mode shows a `<details>` progressive-disclosure block. No builder/CRM/HR/accounting terms appear in the owner-facing copy.

### 4. Mount

- `apps/web/app/(shell)/storefront/page.tsx` — cockpit as the lead panel when the archetype category is `food-hospitality`. Single mount; the domain-page reframing of `/finance` and `/employee` is deferred to PR #3412 to avoid file collision on those two pages.

### 5. UX checks — `apps/web/lib/restaurant-cockpit/service-readiness-ux.test.ts`

Encodes four owner-fit lenses as assertions against the derived model + rendered markup:
- **repeated generic labels** — no signal/next-action label is a banned generic ("Make this business decision", "Review this decision", "Approve this bill"), and no owner-facing label repeats.
- **technical-detail leakage** — Simple mode markup contains none of the `technical[]` values nor builder tokens (`BI-`, `FB-`, `HITL`, `SLA`, `Epic`).
- **small controls** — the primary next-action control renders with `min-height`/`min-width` ≥44px.
- **route-to-route signal consistency** — the cockpit's demand counts equal the counts a `/storefront/inbox`-shaped source produces from the same inputs.

## Boundary copy (BI-3326DA86)

Finance copy states it is readiness, not a full accounting/POS replacement ("Draft figures — confirm in your books"). No claim of being the system of record.
