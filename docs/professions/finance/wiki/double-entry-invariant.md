---
title: Double-entry invariant — debits equal credits
pageKind: principle
status: published
abstract: Every transaction is recorded with equal and opposite debit and credit entries; total debits must equal total credits, and Assets = Liabilities + Equity always holds. This is the non-negotiable foundation of bookkeeping.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Record every transaction as balanced debit and credit entries; never post a one-sided or unbalanced entry.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "evidence_density": 0.8}
professionCompetencyLevel: foundational
sources:
  - wikipedia/double-entry-bookkeeping
---

## Rule

Every financial transaction is recorded with **equal and opposite entries** — debits and credits — across at least two accounts. The books are correct only when **total debits equal total credits**, and the accounting identity **Assets = Liabilities + Equity** holds at all times.

## Why

Double-entry bookkeeping rests on duality: each transaction has a debit (value flowing to an account) and a matching credit (value flowing from an account). Because the two sides must balance, the system maintains accuracy and **allows detection of errors or fraud** — an unbalanced trial balance is a signal that something is wrong.

This is not a stylistic choice. A one-sided entry breaks the accounting equation and renders every downstream statement unreliable.

## How To Apply

1. **Balance every entry.** Debits and credits for a transaction sum to equal totals before posting.
2. **Preserve the identity.** Any posting must leave Assets = Liabilities + Equity intact.
3. **Use the trial balance as a check.** A non-zero difference means an error to find, never to plug.
4. **Recognize on the accrual basis** — when the economic event occurs, not when cash moves: see [[professions/finance/accrual-basis-accounting]].

## See Also

- [[professions/finance/accrual-basis-accounting]]
- [[professions/finance/segregation-of-duties]]
