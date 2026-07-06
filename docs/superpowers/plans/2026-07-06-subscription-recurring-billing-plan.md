# Plan — Subscription recurring billing + renewal lifecycle (BI-8681E93C)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 1 of the parity gap matrix
(docs/superpowers/specs/2026-07-06-sales-crm-parity-delight-gap-matrix.md).

## Substrate finding (dpf-verify-substrate-first)

A complete recurring-invoice engine already exists: `RecurringSchedule` (+ line items),
`generateDueInvoices()` (idempotent per-period, auto-send, GL rides `sendInvoice`), and a
daily 06:30 cron (`recurring-invoice-dispatch`). Support contracts (Subscription, PR #2609)
carry `billingCadence`/`renewalDate` but nothing minted renewals. The slice is therefore
WIRING, not a new engine.

## Design

- Migration `20260706060000`: `RecurringSchedule.subscriptionId` (nullable, unique, SetNull
  FK) — a schedule can be the renewal engine of exactly one contract. Data-safe attested.
- `convertOrderToSubscription`: auto-renew contracts also create their paired schedule —
  name "<plan> — renewal", frequency mapped from cadence (annual→annually), amount/currency
  from the order, `startDate`/`nextInvoiceDate` = renewalDate (the order billed the first
  period), one line item, autoSend. Non-auto-renew contracts get NO schedule.
- `generateDueInvoices()`: after minting for a linked schedule, advance the contract's
  `renewalDate` to the schedule's next date (or `expired` when the schedule term completes);
  plus a sweep expiring active non-auto-renew contracts whose renewalDate passed. Returns
  `{generated, sent, expired}`.

## Verification

subscriptions.test.ts (schedule pairing, cadence vocab mapping, none-when-no-autorenew) +
recurring.test.ts (renewalDate advance, expiry sweep) — green. Deploy via self-upgrade;
live check: Emma3D's contract gains a paired REC- schedule on the next contract created,
and the daily cron drives renewals.
