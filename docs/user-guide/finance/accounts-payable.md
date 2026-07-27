---
title: "Accounts Payable"
area: finance
order: 4
---

## Use This Doc For

- `/finance/suppliers`, `/finance/suppliers/new`, and `/finance/suppliers/[id]`
- `/finance/purchase-orders`, `/finance/purchase-orders/new`, and `/finance/purchase-orders/[id]`
- `/finance/bills`, `/finance/bills/new`, and `/finance/bills/[id]`
- `/finance/payment-runs` and `/finance/spend`

## Purpose

Accounts payable connects a supplier commitment to the bill, approvals, and
payment record that settle it. Keep those records linked so a reviewer can
answer what was ordered, what arrived as a payable, who approved it, what was
recorded as paid, and where the supporting bank evidence lives.

## Before You Start

- Confirm the supplier, payment terms, currency, invoice reference, dates, and
  line-item amounts against the source document.
- Link the purchase order when one exists. A bill can be created without a PO,
  but the platform cannot then show a PO-to-bill variance.
- Confirm the real-world payment method and evidence before recording a bill as
  paid. DPF records the event; it does not move money through your bank.
- Use an account with finance-management authority for supplier, bill,
  approval, and payment actions.

## From Commitment To Payment

1. Create the supplier and keep its terms and currency current.
2. Raise a purchase order when the purchase should be authorized before the
   supplier invoices. Sending a PO changes its status to **sent**; converting a
   PO creates a linked **draft** bill.
3. Enter the bill and check the two-way PO match shown on its detail page.
4. Submit the bill for approval. Active approval rules whose amount range
   contains the bill total each create a pending approval.
5. Record payment only after the bill is **approved**. A partial amount changes
   the bill to **partially paid**; settling the remaining balance changes it to
   **paid**.

If no approval rule matches, submission auto-approves the bill. A linked bill
that exceeds its PO tolerance is surfaced as a variance, but that variance is
currently non-blocking when no approval rule applies. Review it rather than
interpreting auto-approval as a successful match.

## Approval And Payment Consequences

- Every matching approval must approve before the bill becomes approved.
- If any approver rejects, the bill returns to **draft** so it can be corrected
  and resubmitted. The approval responses remain part of the record.
- Server-side checks reject a payment against a bill that is not approved or
  partially paid, reject non-positive amounts, prevent overpayment, and derive
  currency from the bill.
- A payment run accepts approved bills only. It records completed outbound
  payments, allocations, and paid bill states, either consolidated per supplier
  or separately per bill.
- **Record as Paid** is not a bank instruction. Make the real payment in the
  banking channel, retain its reference, and then record the result in DPF.

## Recovery And Evidence

Correct a rejected or inaccurate bill while it is back in draft and preserve
the approval comments that explain why. Do not create a duplicate payment to
repair a missing reference or bank match. Instead, reconcile the existing
payment from the banking workspace. Payment and paid-state actions do not offer
a general undo in the current workflow, so verify amount, currency, supplier,
date, and reference before confirming them.

Useful evidence includes the supplier invoice, purchase order, approval
responses, variance explanation, payment confirmation, payment reference, and
the matched bank transaction.

## Related Help

- [Banking and reconciliation](banking-and-reconciliation.md)
- [Reporting and close](reporting-and-close.md)
- [Controls and automation](controls-and-automation.md)
