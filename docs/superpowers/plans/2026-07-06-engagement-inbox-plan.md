# Plan — Engagement inbox: work-these-now queue with reasons (BI-5D63E53D)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 4 of the parity gap matrix —
the Close-Inbox / Salesloft-Rhythm mechanic: a prioritized queue where every item says WHY.

## Substrate finding (dpf-verify-substrate-first)

The Revenue Cockpit on /customer already renders `attentionItems` ("No urgent revenue
actions right now" when empty) fed by `buildRevenueCockpitSummary`. The inbox is an
EXTENSION of that surface, not a new card: richer signals, urgency-ordered, plain-language
reasons.

## Design

- `RevenueCockpitInput` gains optional `renewalsDueSoonCount` + `overdueInvoiceCount`
  (back-compat: absent → omitted).
- Attention items now build in urgency order, each with a why:
  1. overdue invoices (danger) — "chase payment" → /finance/invoices
  2. stale opportunities (warning) — existing
  3. new leads awaiting triage (attention) — derived from engagement "new" counts
  4. support contracts renewing within 30 days (info)
  5. marketing work waiting (accent) — existing
- /customer page adds two counts: active subscriptions with renewalDate ≤ 30d out, and
  sent/viewed/partially_paid invoices past dueDate.
- Deliberately independent of the (in-flight) next-step slice: no-next-step/overdue-step
  markers live on the pipeline tiles; they can join the inbox as a follow-up once merged.

## Verification

revenue-cockpit tests: ordering + phrasing + back-compat (7/7). Live: /customer shows the
queue instead of "No urgent revenue actions" once signals exist.
