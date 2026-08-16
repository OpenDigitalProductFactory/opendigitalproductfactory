# Plan — Instrument the recurring "retain" stage (BI-A72D29BE)

**BI:** `BI-A72D29BE` (Workstream 2) · **Epic:** `EP-VSL-SURFACE`
**Depends on:** `BI-E55991E9` (grammar, merged) · stacked on `BI-9078F4EE`
**Date:** 2026-08-15 · **Branch:** `feat/vsl-retain-instrumentation`

## Design grounding

A surface sweep corrected the BI's premise: there is **no `Contract` table** — the domain is `model Subscription` (renewalDate/autoRenew/billingCadence/totalValue), and it is **already migrated** (`20260704120000_add_subscription_support_contract`), alongside `RecurringSchedule`. So **no schema migration is required.** The gaps were purely instrumentation: no MRR/ARR computation, no customer-health/churn signal, and no retain surface existed anywhere. This BI builds those from live data and reads them through the account grammar (`active`-stage `at_risk` state) shipped in BI-E55991E9.

**Scope note (onboarding milestones):** a *persisted* onboarding-milestone model would add a new Prisma model + the ~6-gate cascade. This BI represents retain health/engagement from existing signals and defers a dedicated milestone model to a clean follow-up BI if it proves needed — keeping this workstream migration-free.

## Deliverables (atomic — one retain-instrumentation slice)

1. **Pure metrics** — `apps/web/lib/crm/retain-metrics.ts`: `monthlyRecurringValue` (cadence/frequency normalisation), `computeMrr`/`computeArr` (schedules supersede contract estimate), `assessAccountHealth` (renewal proximity + auto-renew + engagement recency + recurring presence → `healthy`/`watch`/`at-risk`, with a human-in-the-loop `suggestAtRisk`). No server imports; fully unit-tested.
2. **Server data** — `apps/web/lib/crm/retain-data.ts`: `getWorkspaceRetainMetrics` (MRR/ARR + health tally, bounded aggregate queries — no N+1) and `getAccountRetainSnapshot` (per-account).
3. **Cockpit** — `revenue-cockpit.ts` gains a Recurring-revenue metric (MRR/ARR) and an "accounts at churn risk" attention item; the CRM hub feeds them from the rollup.
4. **Account detail** — `AccountRetainPanel` shows MRR/ARR, health band + reasons, next renewal, and a churn-risk prompt, for retain-stage accounts.

## Verification

- Unit: `retain-metrics.test.ts` (11) + CRM regression — green.
- Typecheck: `apps/web` clean. Ratchets (module-size, prose, style/token) green.
- Local merged-CI gate before push; live UX verification of the cockpit + account panel recommended.

## Backlog Coverage

Atomic: the MRR/ARR rollup, the health/churn signal, and their two surfaces (cockpit + account panel) are one indivisible retain-instrumentation slice reading the same recurring substrate — none is independently useful without the metrics engine. No phase is independently shippable.
