---
title: "Accounts Payable"
area: finance
order: 4
lastUpdated: 2026-04-25
updatedBy: Codex
---

## Use This Doc For

- `/finance/bills`
- `/finance/bills/[id]`
- `/finance/bills/new`
- `/finance/purchase-orders`
- `/finance/purchase-orders/[id]`
- `/finance/purchase-orders/new`
- `/finance/suppliers`
- `/finance/suppliers/[id]`
- `/finance/suppliers/new`
- `/finance/spend`

## Workflow

1. Validate the supplier and commitment source.
2. Record the bill or purchase order with the right approval context.
3. Track due items through payment readiness.

## What To Watch

- supplier records that do not match the payable being processed
- bills entered without the approval or receipt context they depend on
- spend views being treated as the source of truth instead of the underlying payable records
