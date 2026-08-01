---
title: "Accounts Receivable"
area: finance
order: 3
---

## Use This Doc For

- `/finance/invoices`, `/finance/invoices/new`, and `/finance/invoices/[id]`
- `/finance/payments`
- `/finance/revenue`
- the customer payment page reached from an invoice's secure pay link

## Purpose

Accounts receivable turns delivered work or a valid customer charge into an
invoice, records what the customer has paid, and keeps the remaining balance
visible. An invoice status is an operational claim, so move it only when the
underlying customer communication or payment evidence supports the change.

## Before You Start

- Confirm the customer account, contact, due date, currency, payment terms, tax,
  discount, and source order or service.
- Use at least one line item with a clear description, quantity, and unit price.
- Decide whether the customer must sign before payment. The signature setting
  controls the public payment page; it is not an internal approval.
- Keep internal notes separate from customer-facing notes.

## Invoice And Collection Workflow

1. Create the invoice. New invoices start in **draft**.
2. Review the totals and source context before sending.
3. Send the invoice. DPF creates or reuses a secure pay token, records
   **sent**, and timestamps the event.
4. When the customer opens the payment link, the invoice is marked **viewed**.
   If a signature is required, the public page records signer name, email,
   signature image, and timestamp.
5. After money is actually received, record an inbound payment against the
   invoice. DPF creates a completed payment and allocation, increases the
   amount paid, decreases the amount due, and sets **partially paid** or
   **paid**.
6. Match that recorded payment to the imported bank transaction during
   reconciliation.

Sending and recording payments make best-effort ledger postings. The customer
workflow is not failed merely because the ledger post has a transient problem,
so use the underlying invoice, payment, and ledger evidence together during
review.

## Starting An Invoice From Context

Food-and-hospitality organizations can open `/finance/invoices/new` with a
`from` parameter so the page uses the right business language:

- Restaurant: `booking`, `order`, `catering`, `private-event`, or `no-show`.
- Catering: `quote`, `event-deposit`, `event-balance`, or `private-event`.
- Bakery: `custom-order`, `counter-sale`, or `delivery`.

A contextual entry point changes the heading, helper copy, and starting
context. It does not prove that a charge is owed. In particular, a catering
quote remains a price proposal until the client accepts it. A blank invoice is
always available, and other archetypes retain the customer-first form.

## Decisions, Recovery, And Evidence

Recording a payment does not charge a card, initiate a transfer, or verify bank
settlement. Confirm the external receipt first. Payment allocation updates the
invoice immediately, and the current workflow does not provide a general
payment undo, so check amount, direction, currency, reference, and invoice
before saving.

Use **void** only when the invoice should no longer be collectible and preserve
the business reason in supporting records. Do not mark an invoice paid to
remove it from an overdue queue. For a partial receipt, record the actual
amount; the remaining balance stays visible.

### Status Movement Is Governed

Invoice status follows a declared transition map, so an unsupported move is
refused with the reason rather than silently accepted. In particular a **paid**
invoice cannot be voided — issue a credit note instead, so the ledger keeps both
halves of the story — and **void** is terminal: correcting a voided invoice
means raising a new one. Sending is refused for an invoice that is void, paid,
or written off; resending one that is already sent is allowed, because chasing a
customer with a fresh payment link is normal collection work.

### Void Versus Delete

**Void** keeps the invoice on record and neutralises its economics. It
unallocates any payments (the payment record itself is kept, because the money
really did arrive), posts a reversing journal entry for any general-ledger
postings rather than deleting them, and returns linked billable time to the
unbilled pool.

**Delete** is only for an invoice that never became a business record: a draft
with no payment allocation, no ledger posting, and no dunning history. Anything
else must be voided so the audit trail survives. Deleting removes the invoice
and its line items permanently and returns any linked billable time to the
unbilled pool; it cannot be undone.

Prefer void whenever there is doubt. Delete exists for the mistake you catch
before it leaves the building, not for tidying up.

Keep the source order or service, sent invoice, delivery evidence, signature
when required, processor or bank receipt, payment reference, and reconciled
bank transaction as the evidence chain.

## Related Help

- [Banking and reconciliation](banking-and-reconciliation.md)
- [Reporting and close](reporting-and-close.md)
- [Controls and automation](controls-and-automation.md)
