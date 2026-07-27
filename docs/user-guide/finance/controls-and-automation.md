---
title: "Controls And Automation"
area: finance
order: 7
---

## Use This Doc For

- `/finance/settings`, `/finance/configuration`, and currency, dunning, and tax
  settings
- `/finance/recurring`, `/finance/recurring/new`, and
  `/finance/recurring/[id]`
- `/finance/payment-runs`

## Purpose

Finance controls make repeatable work safer, but configuration is not proof
that the result was correct. Treat approval rules, recurring schedules,
dunning, tax configuration, currency, and payment runs as governed operating
instructions whose outputs still require review.

## Before You Change A Control

- Name the owner, intended population, effective date, and evidence for the
  change.
- Check existing invoices, bills, schedules, reports, and integrations that
  depend on the setting.
- Confirm whether the action creates records, communicates externally, or only
  changes future behavior.
- Use a finance-management account and arrange an independent review for
  material approval, tax, or payment changes.

## Recurring Invoices

An active schedule whose next invoice date is due creates one
`recurring_instance` invoice for that schedule and date. The generator checks
for an existing invoice for the same schedule and day before creating another,
uses the schedule's currency and line items, and gives the invoice a 30-day due
date. If **auto-send** is enabled, it also sends the invoice and creates the
customer pay link.

After generation, the schedule advances its next date. It becomes
**completed** when its next occurrence would be beyond the end date. Schedules
can also be paused or cancelled. Review the generated invoice even when
idempotency prevents same-day duplication; source pricing, tax, customer, or
schedule dates can still be wrong.

## Dunning, Currency, Tax, And Approvals

Dunning evaluates open sent, viewed, partially paid, or overdue invoices,
records reminder logs, and can change a past-due invoice to **overdue**. Confirm
the customer balance and communication policy before enabling reminders.

The base currency is an organization display and finance default. Changing it
does not retroactively convert existing transaction amounts. Tax configuration
can create obligation periods, filing artifacts, reminders, and remittance
runs; a recorded submitted or paid state must be backed by the real authority
handoff and payment evidence.

Bill approval rules are amount-range controls. Every matching rule creates an
approval, while no matching rule currently allows auto-approval. Test boundary
amounts and approver availability before relying on the rule set.

## Payment Runs Are Records, Not Transfers

A payment run refuses bills that are not approved. It then records completed
outbound payments, allocations, and paid bill states, consolidated per supplier
or separated per bill. It does not instruct a bank. Verify the external payment
and references first because the current workflow does not provide a general
payment-run rollback.

## Recovery And Evidence

Pause a recurring schedule before correcting future behavior; do not delete
generated invoices to disguise a schedule error. Correct dunning or tax
outcomes with preserved evidence and the relevant operational workflow.
Reconcile existing payment records instead of recording duplicates.

For every material control, retain the prior and new values, owner, approval,
effective date, affected population, test result, generated-output sample, and
recovery decision.

## Related Help

- [Accounts payable](accounts-payable.md)
- [Accounts receivable](accounts-receivable.md)
- [Reporting and close](reporting-and-close.md)
