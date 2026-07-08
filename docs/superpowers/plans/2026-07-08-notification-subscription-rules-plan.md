# User-configurable notification / subscription rules — plan (BI-997503EC)

- **Date:** 2026-07-08
- **Epic:** EP-CLAUDE-INSIDE-OUT (declarative-admin-layer, top-10 gap #10 / matrix residue)
- **BI:** BI-997503EC
- **Kernel altitude ledger:** DI-D1C96829E6BD (deliver-tractable-block-rest)

## Problem

Notification delivery is code-driven: `lib/attention/notify.ts`, the self-upgrade
notifiers, and alert bridges each create `Notification`/`PlatformNotification`
rows from hardcoded call sites. An end user cannot express "notify me when a
record in category X matching filter Y changes." Per the config-vs-standard
research (PR #2699), notification rules are irreducible per-user residue — they
belong to a first-class rule engine, not to code.

## Approach (substrate-first)

Reuse the existing per-user `Notification` model as the delivery target; add a
durable rule + a pure matcher + a dispatch seam.

### Slice 1 (this PR)

1. **Schema** — `NotificationSubscription` (userId FK→User, eventCategory,
   optional JSON equality filter, channel, cadence immediate|digest, active).
   Additive migration, data-safe.
2. **Core** — `lib/notifications/subscription-rules.ts`:
   - Pure `matchesSubscriptionFilter` (null/empty filter = all-in-category; else
     every filter key present AND strictly equal — a rule never fires on an
     attribute the event did not report; no type coercion).
   - IO `createSubscription` / `listSubscriptions` / `deleteSubscription`
     (owner-scoped delete).
   - IO `dispatchEventToSubscribers` — finds active immediate rules in the
     category, filters by the matcher, creates one Notification per matching
     owner (de-duped by user). This is the seam Slice 2 event sources call.
3. **User actions** — `lib/actions/notification-rules.ts`, each scoped to the
   authenticated user via `requireUserId` (create/list/delete own rules).
4. **Tests** — pure matcher (all-in, strict equality, missing-attr, no coercion)
   + create validation + dispatch (per-user de-dup, no-match no-op, active/
   immediate query shape).

### Slice 2 (follow-up BI, not this PR)

- Wire `dispatchEventToSubscribers` into concrete record-change sources (backlog
  status change, ServiceTicket updates, build phase transitions) so rules
  auto-fire. Each call site is additive and named by `eventCategory`.
- `digest` cadence batching (a scheduled job that rolls up matched events).
- A management UI (settings surface) over the user actions.

## Safety

- No change to existing notification call sites (additive dispatch seam).
- Owner-scoped everywhere: users touch only their own rules.
- Strict, fail-safe matcher: an under-specified event never over-notifies.
