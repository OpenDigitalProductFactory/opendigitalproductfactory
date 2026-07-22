# EP-UX-COGLOAD residual closure — the gaps that kept five verified-merged BIs open

Date: 2026-07-22
Backlog: BI-348766E5 + BI-A36CF68D, BI-3DA1DFDC, BI-2B2FCB2B, BI-CC580161, BI-F0B389C9 (EP-UX-COGLOAD / EP-ATTENTION-SURFACE)

## Context

The 2026-07-22 backlog↔PR reconciliation verified the EP-UX-COGLOAD fan-out on
origin/main and found five BIs whose merged PRs deliver the core but miss a
named acceptance line each. This plan closes exactly those residuals in one PR —
no re-implementation of the merged cores.

## Backlog coverage

One atomic PR: each phase is a small residual on a different, already-merged
surface; none is independently shippable as a product slice, and together they
flip five BIs (plus the follow-up BI-A36CF68D) to done.

## Phases

1. **Storefront-inquiry attention source (BI-348766E5 / BI-A36CF68D)** — sibling
   of the merged `reservation-exception` source per the BI-A36CF68D proposed
   approach: pure mapper + loader (`sources/storefront-inquiry.ts`), settled =
   `closed`/`in-progress` or routed-to-backlog (derived `BI-SFI-<ref>` marker),
   unknown open statuses stay actionable; wired into `aggregate.ts`,
   `outside-in.ts` (products-and-services-sold), `owner-decision-copy.ts`
   (Front of house), and hard-floored needs-you-now in `owner-routing.ts`.
2. **Booking action-result states (BI-3DA1DFDC)** — StorefrontInbox confirm/cancel
   get pre-action review dialogs naming guest/table/time + consequence, res.ok
   checking, row-specific pending/succeeded/failed messages with retry copy, and
   in-place status update instead of `window.location.reload()`.
3. **Public booking mobile floor (BI-2B2FCB2B)** — 44px minimum on calendar day,
   month-nav, time-slot, ghost and primary buttons in SlotBookingFlow;
   full-context accessible names on time-slot buttons; component mobile smoke
   proving the selected slot stays authoritative on the final form.
4. **Publish confirmation (BI-CC580161)** — PublishLinkedInButton and
   PublishEmailButton gain an explicit review step (channel, artifact title,
   audience, external consequence) before the action fires; archetype-fit
   hard-block unchanged and still ahead of any confirmation.
5. **Inbox/dashboard 390px assertions (BI-F0B389C9)** — filter chips + row
   actions + backlog link sized via `.dpf-tap-target`, chips announce pressed
   state + result count, provider select labelled; e2e mobile-390 assertions
   added for `/storefront` (overflow + first-viewport owner task) and
   `/storefront/inbox` (overflow + chip/action tap targets).

## Design grounding

- SSOT for attention: `docs/superpowers/specs/2026-06-23-human-attention-surface-design.md`
  §1/§4.1 — extended with one new projector source, no materialization.
- SSOT for the booking handoff/action labels: `docs/superpowers/plans/2026-07-22-restaurant-booking-handoff.md`
  (`reservationActionLabel`, booking-summary contract) — extended, not changed.
- SSOT for archetype-fit publish gating: `apps/web/lib/marketing/archetype-fit.ts`
  (#3406/#3414) — the confirmation step composes in front of it.
- Tap-target utility: existing `.dpf-tap-target` (44px) from #3397 — reused, not
  reinvented.

## Verification

- Unit: storefront-inquiry mapper/routing, StorefrontInbox action-result suite,
  SlotBookingFlow mobile smoke, PublishLinkedInButton confirmation suite.
- Canonical typecheck (`tsc --noEmit`) + CI (Typecheck / Prod Build / Unit / DCO).
- Live-install UX verification pending governed self-upgrade deploy.
