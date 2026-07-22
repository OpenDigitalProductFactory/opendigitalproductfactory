---
title: "Accounts Receivable"
area: finance
order: 3
---

## Use This Doc For

- `/finance/invoices`
- `/finance/invoices/new`
- `/finance/invoices/[id]`
- `/finance/payments`
- `/finance/revenue`

## Workflow

1. Confirm the customer-facing charge or invoice is correct.
2. Send or record the receivable event.
3. Apply payments and review what remains outstanding.

## Starting an invoice from context (food & hospitality)

For the **food-hospitality** archetype, `/finance/invoices/new` can start from a specific billing context instead of only a generic customer dropdown. Opening the page with a `from` parameter sets a contextual heading, an entry-point chooser, a context badge, and helper copy matched to your business. The same entry points appear as cards on the owner-first `/finance` overview.

The available contexts depend on the business:

- **Restaurant** — `?from=booking`, `?from=order`, `?from=catering`, `?from=private-event`, and `?from=no-show`. Copy uses guest and booking language.
- **Catering** — `?from=quote` (price a job before it is confirmed; nothing is owed until the client accepts), `?from=event-deposit` (the deposit that secures the date), `?from=event-balance` (the remainder once the event is delivered), and `?from=private-event`. The account picker is labelled **Client**.
- **Bakery** — `?from=custom-order` (celebration or wedding cake, deposit up front and balance on collection), `?from=counter-sale` (a standard over-the-counter sale), and `?from=delivery` (a pickup or delivery fee).

A blank invoice is always available. Other business types keep the standard customer-first invoice form and professional-services copy.

## What To Watch

- invoices sent before the underlying customer or service data is ready
- payments recorded without clearing the expected receivable
- revenue views being used as an operational queue instead of a summary surface
