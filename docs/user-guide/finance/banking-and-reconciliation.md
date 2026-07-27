---
title: "Banking And Reconciliation"
area: finance
order: 2
---

## Use This Doc For

- `/finance/banking` and `/finance/banking/new`
- `/finance/banking/[id]`
- `/finance/banking/[id]/import`
- `/finance/banking/[id]/reconcile`
- `/finance/banking/rules`

## Purpose

Banking and reconciliation connect statement activity to the payments recorded
in DPF. Importing establishes what appeared at the bank; matching establishes
which recorded payment explains a transaction. Keep those two claims separate
so categorization is not mistaken for settlement evidence.

## Before You Import

- Confirm the bank account, account currency, statement period, opening
  position, and file source.
- Avoid importing the same statement twice. Each import creates transaction
  records and an import-batch identifier; review parsing errors before assuming
  the batch is complete.
- Review bank rules before relying on them. Rules are applied as transactions
  are imported and currently provide categorization context; they do not create
  or approve payments and do not reconcile transactions.

## Import And Reconcile

1. Create or open the bank account.
2. Import the statement activity. Each parsed row starts **unmatched**. When the
   file supplies balances, the account uses the last supplied balance;
   otherwise DPF adds the imported net movement to the current balance.
3. Review rule-applied categories and correct the source or rule when the
   classification is misleading.
4. Open reconciliation and request candidate matches. Current suggestions
   compare a transaction with unreconciled **inbound** payments using amount,
   date, description, and reference signals.
5. Confirm the right payment. Matching marks the bank transaction **matched**
   and the selected payment **reconciled**, with a reconciliation timestamp.
6. Investigate every remaining unmatched row before treating a reporting period
   as ready.

Suggestions are candidates, not decisions. Verify direction, amount, date,
counterparty, reference, and the related invoice or evidence before matching.
Outbound supplier payments may require manual identification because the
current suggestion query is inbound-focused.

## Consequences And Recovery

A match changes both sides of the relationship: the bank transaction points to
the payment and the payment becomes reconciled. If the match is wrong, use
**unmatch**. DPF clears the transaction's payment link and resets the payment's
reconciled flag and timestamp, allowing the correct match to be made. This is
the normal reversible correction path; do not import a duplicate transaction
or record a duplicate payment.

Deleting a bank rule stops future use of that rule but does not rewrite prior
transactions. Correct already-imported categorization explicitly. Imported
account balances depend on the file content and import history, so retain the
original statement and batch details when investigating a discrepancy.

## Reconciliation Evidence

For each period, retain the source statement, import batch, parsing errors,
unmatched-item review, matched payment references, and explanations for any
items deliberately left open. A zero unmatched count is useful operational
evidence, but it does not by itself prove that every payment was correctly
authorized, posted, or classified.

## Related Help

- [Accounts receivable](accounts-receivable.md)
- [Accounts payable](accounts-payable.md)
- [Reporting and close](reporting-and-close.md)
