# Plan — Wire the CRM to the value-stream/lifecycle substrate (BI-9078F4EE)

**BI:** `BI-9078F4EE` (Workstream 1) · **Epic:** `EP-VSL-SURFACE`
**Depends on:** `BI-E55991E9` (canonical lifecycle grammar — this branch stacks on `feat/vsl-lifecycle-grammar`)
**Date:** 2026-08-15 · **Branch:** `feat/vsl-crm-lifecycle-wiring`

## Design grounding

Source of truth is the canonical lifecycle grammar shipped in BI-E55991E9 (`apps/web/lib/lifecycle-grammars.ts` — `CUSTOMER_ACCOUNT_GRAMMAR`, `OPPORTUNITY_GRAMMAR`, `resolveCustomerAccountPoint`) and the OVSM stage keys (`packages/storefront-templates/src/operational-value-stream.ts`). This BI **consumes** that grammar; it invents no new lifecycle enum. The account-status union (`packages/db/src/customer-lifecycle.ts`, 9 values) is unchanged.

A surface sweep found the CRM already surfaces 7 of 9 account statuses in the UI (`ACCOUNT_STATUS_META`, `OPERATOR_SETTABLE_ACCOUNT_STATUSES`); the real gaps were: MCP `create_customer_account` capped at 4 in prose, no OVSM binding anywhere, a storefront-only funnel, and no signal-assisted transitions.

## Deliverables (atomic — one coherent "wire CRM to lifecycle" slice)

1. **OVSM binding** — `apps/web/lib/crm/account-value-stream.ts`: pure `accountStatusToOvsmStage` / `opportunityStageToOvsmStage` / `ovsmStageLabel` mapping onto the six primary OVSM stages; account detail page shows the value-stream position. (AC3)
2. **MCP full status set** — `crm-sales-pipeline-pack.ts`: `create_customer_account.status` now an `enum` of the settable canonical statuses (9 minus the two system-managed tombstones), with handler validation returning `invalid_status`. (AC2)
3. **Signal-assisted transitions** — `apps/web/lib/crm/account-lifecycle.ts` `applyAccountStatusTransition` (gated or authoritative, records a `LifecycleEvent` with the state axis) wired into `createOpportunity` (→ `qualified`, gated), `advanceOpportunityStage`/`closeOpportunity` on won (→ `active`, authoritative). Operator override via the existing admin control, whose status changes now also record a `LifecycleEvent`. (AC5, AC1)
4. **Storefront-optional funnel** — `funnel/page.tsx`: top of funnel is fed by direct + reseller leads (early-lifecycle accounts) when no storefront activity exists; empty state only when there is truly no pipeline. (AC4)
5. **Writer extension** — `recordLifecycleTransition` gains an `authoritative` flag (skips the readiness gate for operator overrides / business-authoritative events; point validity still enforced).

No new enum invented; aligns to the canonical grammar (AC6).

## Verification

- Unit: `account-value-stream.test.ts` (10) + grammar/writer/pipeline regression — all green (46).
- Typecheck: `apps/web` clean.
- Local merged-CI gate before push; live UX verification of the funnel + account detail recommended on the running portal.

## Backlog Coverage

Atomic: the OVSM mapping, MCP status set, signal transitions, and storefront-optional funnel are one indivisible "wire the CRM to the lifecycle substrate" slice — each reads the same grammar and none is independently useful without the others (a funnel fed by lifecycle stages needs the accounts to move through those stages via the signals; the OVSM view needs the mapping). No phase is independently shippable.
