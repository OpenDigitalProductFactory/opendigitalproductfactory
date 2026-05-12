---
title: Auto-populate or it's already wrong
pageKind: heuristic
status: draft
abstract: It is not humanly possible to manually track the rapid inflation and deflation of virtualised cloud, hybrid, and on-prem resources. If your CMDB depends on humans to enter records, it's already lying to you.
sources:
  - frameworks/csdm
---

## The heuristic

> Any configuration, asset, or inventory record that depends on a human to enter or maintain it is **already wrong**. Auto-populate or accept that the record is decoration.

## When it applies

Designing a CMDB, an asset inventory, a software catalog, a service registry, or any operational data source that needs to reflect current reality. Also: AI-co-worker context surfaces that rely on platform data being accurate.

## Why it works

The rate of change of virtualised cloud resources, hybrid environments, and on-prem fleets exceeds what manual entry can keep up with. Records age in minutes; humans update on weekly or quarterly cycles. The gap compounds. By the time anyone looks at the CMDB to make a decision, the data is stale enough that the decision is wrong.

The fix is structural: every record in the CMDB has an automated discovery source feeding it. Manual edits are exceptions, and they trigger review. The first pillar of trusted data — Ingestion — is non-negotiable.

The second-order consequence: if you can&#39;t auto-discover an entity, you probably can&#39;t reason about it operationally either. The lack of a discovery pathway is itself a signal that the entity isn&#39;t operationally tracked.

## Counterexamples

- Strategic-intent records that genuinely live in someone&#39;s head — "this product is scheduled for retirement next year." Those need manual entry, but they should be flagged as forward-looking rather than current-state.
- Compliance attestations that require human sign-off.
- Records about people / teams / org structure, where the source of truth is HR, not the infrastructure layer.

## See also

- Parent stance: `[[stances/trust-the-cmdb-or-rebuild-it]]`
- Related heuristic: `[[heuristics/model-what-naturally-happens]]`
- Entity: `[[entities/csdm]]`
