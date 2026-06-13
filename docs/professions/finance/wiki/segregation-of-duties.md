---
title: Segregation of duties
pageKind: principle
status: published
abstract: No single individual should control all phases of a transaction. Authorization, custody, record-keeping, and reconciliation are separated so that error or fraud requires collusion to go undetected.
principleTier: core
principleDirection: Separate authorization, custody, record-keeping, and reconciliation across people; never let one actor own a full transaction lifecycle.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.9, "public_safety": 0.6, "blast_radius": 0.7}
professionCompetencyLevel: foundational
sources:
  - gao/green-book-internal-control
---

## Rule

Assign responsibilities so that **no single individual controls all phases of a transaction**. The four duties to keep apart are **authorization**, **custody** of assets, **record-keeping**, and **reconciliation**. When these are separated, undetected error or fraud requires collusion rather than a single point of failure.

## Why

The GAO Green Book (*Standards for Internal Control in the Federal Government*) treats segregation of duties as a control activity within the broader internal-control system, defining it as assigning responsibilities so that no one person has control over all phases of a transaction. It is one of the control activities that, together with the other components, gives reasonable assurance that objectives are met. The Green Book aligns with the COSO Internal Control framework.

## How To Apply

1. **Map the four duties** for each material transaction class and confirm no person holds more than one in a way that defeats the control.
2. **Compensate when separation is impossible** (small teams) with detective controls — independent review, reconciliation, and monitoring.
3. **Apply it to the close.** In month-end posting, the preparer of a journal entry should not also be its sole approver — reinforcing [[professions/finance/double-entry-invariant]].

## See Also

- [[professions/finance/internal-controls-five-components]]
- [[professions/finance/double-entry-invariant]]
