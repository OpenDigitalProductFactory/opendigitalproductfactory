# Restaurant booking handoff — traceable owner-facing reservation task

**Backlog item:** BI-3DA1DFDC (epic EP-UX-COGLOAD — Live UX cognitive-load audit follow-up)
**Status:** implemented
**Date:** 2026-07-22

## Backlog coverage

- Decision: atomic
- Parent: `BI-3DA1DFDC`
- Rationale: The reservation handoff is one cross-surface invariant — the structured `StorefrontBooking` columns, the public booking-form capture, the owner-inbox summary, and the workspace reservation-exception attention source must ship together or the handoff is incomplete (columns without the inbox render leave owners no traceable summary; the workspace source without the columns has nothing structured to project). The sections below are implementation sequencing, not independently shippable product slices.
- Dependencies: none
- Receipt: `cmrvotlw608k701rwnatgd7rq`

## Problem

The live customer-to-owner journey for the Restaurant archetype does not form a
clear, traceable handoff for a non-technical owner (audit 2026-07-22):

1. **Public booking form is ambiguous.** The slot flow at
   `/s/[slug]/book/[itemId]` (`apps/web/components/storefront/SlotBookingFlow.tsx`)
   reuses the archetype's *inquiry* `formSchema`, which for food-hospitality carries
   `date`, `time`, `covers`, and `dietaryRequirements`. Those `date`/`time` fields
   render as **editable inputs after a slot was already selected**, making the
   chosen date/time ambiguous; `covers`/dietary are captured only as free-text lines
   prepended to `notes`. Most controls also lacked label/`for` associations.
2. **Owner inbox is not traceable.** `/storefront/inbox` showed a booking as a bare
   ref + date, with repeated bare `Confirm`/`Cancel` buttons — no item/table, party
   size, dietary, or next action, and no row-specific accessible action text.
3. **Workspace buries reservations.** `/workspace/inbox` is dominated by generic
   coworker (enterprise-architecture) decision cards; a reservation needing the
   owner's confirmation is not surfaced as customer-facing work.

## Design grounding

- **Source of truth (attention):** `docs/superpowers/specs/2026-06-23-human-attention-surface-design.md`
  (§4.1 sources, §4.4 triage, the OUTSIDE-IN cockpit). This change **extends** that
  spec with one new source; it does not alter its contracts.
- **Substrate reuse:** the reservation lives in `StorefrontBooking` (single source of
  truth); the attention item is a read-model projection (no parallel persisted
  record), exactly like the existing sources. No new primitive — a new `AttentionSource`
  value plus a source adapter, mirroring `sources/business-approvals.ts`.
- **Portfolio:** reservations are customer-facing revenue, so they classify under
  `products-and-services-sold` (outside-in depth 0), which is why they surface ahead
  of and separately from `for-employees` coworker cards without a fabricated score.

## Changes (all under `apps/web/` + `packages/db/`)

1. **Structured booking context.** `StorefrontBooking` gains `covers Int?` and
   `dietaryNotes String?` (migration `20260722060000_storefront_booking_covers_dietary`).
   `submitBooking` persists them (main + recurrence children).
2. **Shared pure vocabulary.** `apps/web/lib/storefront/booking-summary.ts` — field
   classification (drop slot-derived date/time, map covers/dietary to structured
   roles), `parseCovers`, `formatReservationWhen` (storefront-tz), `nextActionForReservation`,
   and `reservationActionLabel` ("Confirm Jane Smith, Table for 2 at 6:30 PM"). Backs
   the form, the inbox, and the attention source so the copy never drifts.
3. **Booking form.** `SlotBookingFlow` drops the slot-derived fields, captures
   covers/dietary as structured facts, adds a "Your reservation" summary as the single
   source of truth for date/time (with a "go back to change the slot" hint), and
   associates every control with a `label htmlFor`/`id`.
4. **Owner inbox.** `/storefront/inbox` resolves the booked item name and renders a
   traceable reservation summary (item/table · when · covers · dietary · next action);
   `Confirm`/`Cancel` carry row-specific `aria-label`s.
5. **Workspace reservation exceptions.** New `reservation-exception` attention source
   (`apps/web/lib/attention/sources/reservation-exception.ts`) projects `pending` /
   `needs-reschedule` / overlap-quarantined bookings, classified `products-and-services-sold`
   and hard-floored to `needs-you-now` so a waiting guest is never batched into a digest.

## Tests (smoke — no destructive/external actions)

- `lib/storefront/booking-summary.test.ts` — field partitioning, covers parsing,
  tz-aware time, next action, and the accessible action label.
- `lib/attention/sources/reservation-exception.test.ts` — the public booking intake
  state → attention item mapping (title/context/blast-radius/portfolio/routing), the
  overlap-quarantine escalation, and that a reservation lands in `needs-you-now`
  *separately from and ahead of* a generic coworker decision card.

All projection/mapping logic is pure and read-only; the smoke tests exercise intake
state → inbox/workspace summary without submitting or mutating anything.

## Verification notes

Source-only worktree: the two new suites (13 tests) pass under vitest via a root
node_modules junction; the touched pure attention suites (59 tests) stay green; a
Prisma client regenerated from the amended schema typechecks the new columns clean.
Full `next build` typecheck runs in CI (the required Typecheck / Prod Build gates).
