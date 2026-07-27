---
title: "Expense Workflows"
area: finance
order: 6
---

## Use This Doc For

- `/finance/my-expenses` and `/finance/my-expenses/new`
- `/finance/expense-claims` and `/finance/expense-claims/[id]`
- the secure expense-approval page reached from an approval request

## Purpose

Expense claims preserve the employee's business expense, its supporting
receipts, the reviewer decision, and the reimbursement status. The claim is not
a supplier bill, and marking it reimbursed does not create a bank transfer or a
separate payable record.

## Before You Start

- Use the employee self-service route for your own claim and the finance queue
  for organization-wide review.
- Give the claim a clear business title, currency, and line-item detail.
- Attach or reference receipts and record the business purpose before
  submission.
- Confirm that an active finance reviewer exists. Submission still succeeds
  without an emailed reviewer, but the claim then depends on the in-platform
  queue for follow-up.

## Submit, Review, And Reimburse

1. Create the claim. It begins in **draft**.
2. Add every expense item and check the total and evidence.
3. Submit the claim. The owning employee or a finance manager can submit it.
   DPF records **submitted**, a timestamp, and a secure approval token.
4. A finance reviewer approves or rejects from the approval request. Approval
   records **approved** and its timestamp; rejection records **rejected** and
   the supplied reason.
5. After the employee has actually been reimbursed through the organization's
   payment channel, a finance manager marks the claim **paid** and DPF records
   the paid timestamp.

The reimbursement action is a record of an external financial event. It does
not create a completed `Payment`, allocate a supplier bill, or initiate money
movement. Preserve the bank or payroll proof separately and reconcile it
according to the organization's process.

## Authority And Consequences

Only the employee who owns the claim or a finance manager can submit it.
Approval links are token-authorized so the recipient must protect the link and
avoid forwarding it. A reviewer should inspect line items and receipts before
responding because the decision immediately changes claim status.

An approved claim remains outstanding until finance records reimbursement.
Reporting treats **paid** claims as expenses for the paid period and treats
submitted or approved claims as pending work. Marking a claim paid prematurely
therefore changes finance summaries even though no bank movement occurred.

## Recovery And Evidence

For a rejected claim, use the recorded reason to correct the underlying
information through the supported workflow; do not mark it approved merely to
clear the queue. The current action surface does not expose a general reversal
for approval, rejection, or reimbursement, so confirm the decision and
external payment first. If a mistaken status has material reporting impact,
preserve the original evidence and escalate for a controlled correction rather
than creating a compensating duplicate claim.

The evidence chain should include the receipt, business purpose, employee,
line-item dates and amounts, submission timestamp, reviewer outcome and reason,
reimbursement proof, and any related bank or payroll reference.

## Related Help

- [Accounts payable](accounts-payable.md)
- [Banking and reconciliation](banking-and-reconciliation.md)
- [Reporting and close](reporting-and-close.md)
