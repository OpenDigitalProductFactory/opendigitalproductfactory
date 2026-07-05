# Plan — CRM engagement lifecycle: prospect → active customer → DPF support contract

Date: 2026-07-04. Companion to the root-cause coworker-grant fix (#2596).

## Why

Driving the Customer Success Manager through a real engagement surfaced two classes of gap:

1. **Post-order model gap** — the CRM chain (account → opportunity → quote → sales order → invoice → payment) is fully modelled, but there was **no model for the support contract** covering a customer's own DPF instance, and **no prospect→active conversion action**. An order says "they bought once"; nothing said "they are under an active support contract with a renewal date, covering these instances."
2. **Seed grant drift** — `seedCoworkerAgents` only *upserted* grants, so a corrected grant set left stale rows behind. `customer-advisor` kept `backlog_write`/`marketing_read`, whose tier-1 tools crowded the per-turn tool budget and pushed `create_quote` past the cap.

## Scope

- **`Subscription` model** (support contract) tied to `CustomerAccount`, created from a `SalesOrder`, optionally covering `EdgeNode`s (the provisioned DPF instances). Migration `20260704120000_add_subscription_support_contract`.
- **Actions** (`apps/web/lib/actions/subscriptions.ts`): `convertAccountToActiveCustomer`, `convertOrderToSubscription` — both idempotent.
- **Seed reconcile**: `seedCoworkerAgents` now deletes grant rows not in the declared set.
- **UI** (follow-on in this PR): account-detail lifecycle controls (accept quote → order + invoice, record payment, convert to customer, create support contract) and a support-contract display, so the whole chain is drivable deterministically through the UX rather than via flaky local-model tool-calling.

## Non-goals

- Recurring-billing materialization (a scheduler that mints monthly invoices from a subscription) — the contract + renewal date land now; recurring invoicing is a later slice.
- Reworking the two-grant-source split (registry vs workforce-seed) — tracked separately; this PR only corrects the reconcile behavior.

## Verification

- Unit tests for the actions (idempotency, contract fields from order) and the seed reconcile (stale grants removed).
- Deploy via self-upgrade (runs `prisma migrate deploy` + reseed), then drive the full lifecycle by clicks for Ian, then Dan.
