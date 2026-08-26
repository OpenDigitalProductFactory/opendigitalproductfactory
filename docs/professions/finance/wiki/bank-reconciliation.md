---
title: Bank reconciliation
pageKind: entity
status: published
abstract: Bank reconciliation matches the transactions on a bank or card statement against the business's own recorded payments and receipts, so the ledger balance and the bank balance agree and every line is accounted for. Unmatched lines are surfaced, never guessed.
professionCompetencyLevel: foundational
sources:
  - wikipedia/bank-reconciliation
  - wikipedia/double-entry-bookkeeping
---

## Definition

Bank reconciliation is the routine of comparing a bank or card statement to the business's own books over a period and resolving every difference until the two agree. It is the day-to-day heart of bookkeeping: it is how the books are kept current and trustworthy, and it is what turns a pile of statement lines into a defensible financial position.

## The loop

1. **Import the statement.** Bring the period's transactions in from the bank/card export. Amounts come from the statement, not from inference; rows that cannot be parsed are surfaced as errors, not dropped or guessed.
2. **Categorize.** Apply bank rules (match on payee, description, or reference) to assign an account/category to recurring transactions automatically; the rest are categorized by hand.
3. **Match.** For each statement line, find the corresponding recorded payment or receipt and reconcile them, so the payment is marked settled. A wrong match is reversible.
4. **Reconcile and report.** When every line is matched (or explicitly excluded), the account is reconciled for the period. What remains unmatched is the exception list the owner needs to see.

## Discipline

- **No fabrication.** Every reconciled amount traces to a source document. A gap — a missing receipt, an unparseable row, a statement not yet provided — is surfaced as an open item, never filled with an assumption.
- **Owner approval for money-of-record actions.** Setting up an account of record and importing a statement change the books materially; they route to the owner for approval rather than being applied silently. Categorization and matching are ordinary, reversible steps.
- **Reversibility.** A match can be undone; a mis-categorization can be re-ruled. The irreversible steps are the ones that carry owner sign-off.

## Why it matters

Reconciliation is what makes every downstream number — income vs. expenses, tax position, cash on hand — evidence-backed rather than a guess. A business whose books are reconciled each cycle can answer "where do we stand?" with confidence; one whose books drift cannot.
