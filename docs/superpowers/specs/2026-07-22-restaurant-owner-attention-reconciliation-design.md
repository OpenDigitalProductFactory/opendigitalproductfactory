# Restaurant owner attention reconciliation — design

- Date: 2026-07-22
- Primary backlog item: BI-348766E5 (Workspace attention must reconcile vertical inbox signals before generic decisions)
- Coordinates with: BI-3DA1DFDC, BI-075F731F, BI-36807E68, BI-7D7EE150, BI-8EA88797
- Epics: EP-UX-COGLOAD, EP-ATTENTION-SURFACE, EP-VERTICAL-FOOD-HOSPITALITY
- Surfaces touched: `apps/web/lib/attention/*`, `apps/web/components/storefront-admin/StorefrontInbox.tsx`, `apps/web/app/(shell)/storefront/inbox/page.tsx`, `apps/web/lib/twin/living-business-snapshot.ts`, `apps/web/components/attention/OwnerDecisionCards.tsx`

## Problem

A non-technical Restaurant owner's most concrete operational work — reservations that need
confirming — is invisible on the primary attention surface, while generic
enterprise-architecture "decisions" flood it. Live audit (2026-07-22) found:

1. `/storefront/inbox` has real booking rows (guest, table, date/time, status, Confirm/Cancel).
2. `/workspace` shows `RESERVATIONS 0 Clear` and `NEEDS YOU Nothing needs you right now`, while
   separately claiming `30 things need you today`.
3. `/workspace/inbox` shows ~28 repeated `Make this business decision?` / `Review this decision`
   cards with no Restaurant vocabulary.
4. Storefront Inbox `Confirm`/`Cancel` buttons are terse and repeated, with no row context or
   consequence framing.

### Root causes (verified in code)

- **No reservation source in the attention aggregate.** `apps/web/lib/attention/aggregate.ts`
  wires 13 loaders (agent/decision/approval/platform); none read `StorefrontBooking`. The
  attention surface is structurally blind to customer demand.
- **The twin "Reservations" queue is hardcoded empty.** `living-business-snapshot.ts:552`
  assigns booking items only to queue index 0 (`items: i === 0 ? queueItems : []`). For the
  restaurant `FLOOR` profile the queues are `[waitlist(0), reservations(1)]`, so Reservations is
  always `0 / Clear` regardless of booking data.
- **Generic residue floods the count.** Every unresolved `DecisionInteraction`
  (`sources/ai-decision.ts`) hard-routes to `needs-you-now` (`owner-routing.ts:49`) with a static
  `Make this business decision?` headline (`owner-decision-copy.ts:6`) and a fallback
  `Review this decision` button (`owner-decision.ts:80`) — the linked `/platform/ai/decisions/...`
  href is rejected by `isOwnerSafeHref`. N unlinked corpus-fallback rows become N identical cards.

## Coordination with BI-3DA1DFDC (PR #3387)

The **reservation attention source itself** — projecting owner-actionable `StorefrontBooking`
rows (pending / needs-reschedule / overlap-quarantined) as customer-facing
(`products-and-services-sold`) attention items, plus the `covers`/dietary schema columns and the
row-specific Storefront Inbox Confirm/Cancel labels — is delivered by the sibling BI-3DA1DFDC PR
(`apps/web/lib/attention/sources/reservation-exception.ts`). To avoid two competing reservation
sources and merge collisions, **this PR does not add its own source or edit the Storefront Inbox
surface.** It delivers the complementary WORKSPACE-side reconciliation that #3387 does not:
demoting the generic-decision noise, fixing the repeated decision labels, fixing the twin
"RESERVATIONS 0" counter, and the cross-surface smoke test. Together the two PRs land the
BI-348766E5 acceptance.

## Design

### 1. Row-specific decision labels (fix 5) — constrained by the plain-language contract

Investigated and **deliberately not changed via card copy.** The owner-facing copy has an
intentional, tested contract (`owner-decision.test.ts`): headlines and choice labels must be plain
language and must never leak the raw technical title (banned `\b(AI|API|DB|GPU|CI|CD)\b`, raw title
hidden behind progressive disclosure — `AttentionInbox.test`). The only per-row datum on an
`ai-decision` item is that raw technical question, so a genuinely per-row *label* cannot be produced
without violating the contract. Instead:

- The **demotion in §2** is the real fix for the "28 identical cards" flood — the generic residue
  leaves `needs-you-now` entirely, so the primary surface no longer repeats.
- The remaining cards are already distinguished by their **per-row `situation`/context body**, and
  the fallback action already carries an exact `?attentionId=` deep link (pre-existing) — the
  BI-8EA88797 exact-target requirement is met without changing the label.

> **Correction (2026-07-29, BI-90B6D8C5).** The second half of that last bullet was wrong. The
> `?attentionId=` deep link pointed at `/workspace/inbox` — the page the card renders on — and no
> consumer for the param was ever built, so the exact-target requirement was **not** met and the
> button could only ever no-op. The fallback has been removed: a card with no action this reader can
> act on now states so in plain language, and in Full view the item's real (builder-rail) action
> becomes the card's own action. See
> [the 2026-07-29 plan](../plans/2026-07-29-attention-dead-action-and-decision-residue.md).

### 2. Demote generic corpus-fallback decisions behind concrete operations

`classifyOwnerAttentionLane` routes an `ai-decision` item that is **unlinked corpus residue**
(`residueReason = coverage-gap` and no `blastRadius`) to `weekly-digest` (grouped advanced
review) instead of `needs-you-now`. Genuine escalations (principle-conflict, high-risk-gate, or
build/task-linked) stay in `needs-you-now`. Result: the primary count reflects concrete,
customer-facing work (reservations lead), and the generic backlog is grouped behind it rather
than flooding "things need you today."

### 3. Twin Reservations queue reconciliation (fix the hardcoded-empty counter)

`living-business-snapshot.ts` distributes booking-derived items across queues by meaning, but
only when a reservations queue exists at index > 0 (so `YARD`/`BAYS`/`TERRITORY`, whose first
queue is the general one, are unchanged):

- A reservations-keyed queue is filled with **upcoming reservations** (`scheduledAt > now`, not
  cancelled/completed), ordered soonest-first.
- The general queue (index 0) excludes those upcoming reservations to avoid double-counting.
- Honest empty label: `No upcoming reservations` (explains a genuine `0` despite past booking
  history — the BI's "explain why" branch), instead of a bare `Clear`.

### Storefront Inbox actions (delivered by BI-3DA1DFDC / #3387)

Row-specific, consequence-framed Storefront Inbox Confirm/Cancel labels are delivered by #3387
(`reservationActionLabel` + aria-labels). This PR does not edit that surface.

## Non-goals

- No reservation attention source, `covers`/dietary schema, or Storefront Inbox edits — those are
  owned by the sibling BI-3DA1DFDC PR (#3387); this PR is the complementary workspace-side half.
- No new Prisma model or enum; no change to the booking write path, availability engine, or the
  paused-work risk model.
- No POS/KDS behavior; no change to the `YARD`/`BAYS`/`TERRITORY` twin queue semantics.

## Test strategy

- Vitest units: routing demotion (corpus fallback → weekly-digest; a coverage-gap decision that
  blocks a concrete outcome stays in needs-you-now), and twin queue distribution (reservations
  queue populated soonest-first, general queue de-duplicated, `isUpcomingReservation` /
  `isReservationQueueKey` edge cases, non-restaurant profiles unchanged).
- Playwright e2e smoke (`e2e/restaurant-vertical-signal-consistency.spec.ts`): asserts the same
  reservation signal is coherent across the public booking context, `/storefront/inbox`,
  `/workspace`, and `/workspace/inbox` (fails if the inbox has actionable bookings while Workspace
  shows only generic corpus decisions). The reservation-signal half depends on #3387's source; the
  action-label contract and the negative-space checks stand alone.
