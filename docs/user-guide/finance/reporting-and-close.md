---
title: "Reporting And Close"
area: finance
order: 5
---

## Use This Doc For

- `/finance/reports` and the report routes beneath it
- `/finance/close`
- profit and loss, cash flow, VAT summary, aged balances, outstanding invoices,
  revenue by customer, and general-ledger review

## Purpose

Reports answer defined questions from the finance records currently in DPF.
The close page is a **close-readiness dashboard** that links to reports,
recurring work, assets, and cash-flow review. It does not post a period-close
journal, lock a period, prevent later edits, or certify the books as complete.

## Understand The Current Basis

The profit-and-loss and finance-period summaries use a cash-basis convention:

- income is paid invoice total where `paidAt` falls in the selected period
- supplier cost is paid bill total, using the bill's `updatedAt` as the
  platform's current proxy for the paid transition
- employee expense is paid claim total where `paidAt` falls in the period
- draft, awaiting-approval, approved, and partially paid bills remain visible
  as pending context but are not included as paid cost

Cash flow sums completed inbound and outbound payment records. Outstanding and
aged reports use open invoice or bill statuses and their remaining balances.
VAT summaries use paid invoices and paid bills for the selected period.

These conventions are operational reporting rules, not a substitute for an
accounting policy decision. Multi-currency period summaries present the base
currency label but currently sum raw transaction amounts without FX conversion
when more than one currency is present. Treat the resulting gap warning as a
reason to reconcile externally before relying on the total.

## Close-Readiness Workflow

1. Confirm all expected invoices, bills, claims, and payments are recorded.
2. Resolve approvals and review partial or overdue balances.
3. Import the complete bank statement period and resolve unmatched
   transactions.
4. Review recurring schedules, active assets, tax posture, and any manual
   adjustments outside DPF.
5. Run the report that matches the decision and confirm its period and source
   convention.
6. Export or preserve the report and supporting transaction evidence.
7. Record the organization's actual close or sign-off in its authoritative
   accounting process. Visiting `/finance/close` alone does not perform it.

## What To Watch

- a paid status recorded before external settlement
- partial payments or open approvals excluded from paid totals
- bill timing inferred from `updatedAt`, especially after later edits
- raw multi-currency sums mistaken for converted base-currency totals
- summary reports used to explain a transaction-level discrepancy
- a readiness dashboard described as a locked or final period

## Recovery And Evidence

If a report looks wrong, trace its source records before adding compensating
entries. Correct reversible bank matches with **unmatch**, resolve open
approvals through their workflows, and preserve explanations for status
corrections. Do not duplicate invoices, bills, claims, or payments merely to
force a summary total.

Close evidence should include the selected period, report export, open-item
review, reconciliation results, approval completion, recurring and asset
checks, tax evidence, identified caveats, reviewer, and the external
accounting-system sign-off when one is used.

## Ask For A Branded Report, Workbook Or Letter

The Finance Controller coworker can turn figures you give it, or figures it
has read, into a branded document saved under **Workspace > Documents**:

- a **report** or board pack, as a Word file and a PDF;
- a **workbook** of tables, with totals as formulas, as an Excel file and a
  PDF;
- a **letter** to a named supplier, donor or funder, as a Word file and a
  PDF.

Each one uses your organization's brand and shows a preview of its pages on
the document page. Ask for changes in the conversation: the coworker
regenerates the document as the next version of the same document, and the
version history keeps the earlier ones. The coworker never sends a letter;
sending it stays your decision. The Admin Assistant can produce reports and
letters the same way, and the EA Architect can draw a process diagram.

## Related Help

- [Banking and reconciliation](banking-and-reconciliation.md)
- [Accounts payable](accounts-payable.md)
- [Accounts receivable](accounts-receivable.md)
- [Controls and automation](controls-and-automation.md)

## Recorded General Ledger And Software Results

General Ledger now reads one explicitly scoped organization and either a valid UTC month or the existing all-recorded selection. Both use the same bounded source validation. Invalid periods never silently select all records. Missing chart or eligible records, incompatible currency or precision, incomplete reversals and oversized or failed reads stay unavailable.

The software-platform Performance view saves the same validated ledger income, expenses and net result through the existing metric refresh. This is a recorded management-ledger view, distinct from the cash-basis summaries described above. A selected month shows movements; prior capital does not become current-month income. All recorded includes the complete available supported ledger history. Neither selection proves complete books, bank cash or an as-of position. Existing Finance read permission and current-organization context apply before any source read.
