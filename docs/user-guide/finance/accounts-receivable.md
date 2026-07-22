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

For the **food-hospitality** archetype, `/finance/invoices/new` can start from a specific billing context instead of only a generic customer dropdown. Opening the page with a `from` parameter — `?from=booking`, `?from=order`, `?from=catering`, `?from=private-event`, or `?from=no-show` — sets a contextual heading, an entry-point chooser, a context badge, and Restaurant-appropriate helper copy (guest/catering language). The same entry points are surfaced as cards on the owner-first `/finance` overview. Other business types keep the standard customer-first invoice form and copy.

## What To Watch

- invoices sent before the underlying customer or service data is ready
- payments recorded without clearing the expected receivable
- revenue views being used as an operational queue instead of a summary surface
