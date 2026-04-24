# AI Provider Finance Bridge Design

| Field | Value |
|-------|-------|
| **Status** | Restored draft aligned to implementation |
| **Created** | 2026-04-23 |
| **Restored** | 2026-04-24 |
| **Author** | Codex + Mark Bodman |
| **Primary Audience** | Finance, platform AI, coworker runtime, operations |
| **Related Areas** | `/platform/ai/providers/[providerId]`, `/finance/spend`, `/finance/spend/ai`, `/finance/suppliers/[id]` |

## Purpose

This design brings AI provider cost and supplier ownership into the Finance operating model.

The platform already supports AI provider configuration and token usage tracking. It also already has finance AP primitives such as suppliers, bills, and payments. What it does not have is a bridge that turns an AI provider from a technical configuration into a finance-owned supplier relationship with contract posture, usage tracking, and actionable follow-up.

The first slice should make AI providers visible to Finance as real operating commitments, not just infrastructure settings.

## Problem Statement

Today provider setup and finance operations are disconnected.

That creates several operational gaps:

- provider setup can succeed while finance never gains supplier ownership
- token usage is tracked, but not in a finance-meaningful contract context
- fixed monthly plans with included usage are easy to underuse without any warning
- there is no dedicated workspace for budget, utilization, or wasted committed spend
- supplier bills and finance follow-up are not seeded from provider onboarding

For subscription-style AI vendors, especially plans with included monthly credits or usage, “use it or lose it” is financially material. The platform should not only track consumption; it should also track unused committed value and surface follow-up work before the billing cycle is lost.

## Current Repo Truth

The implemented slice in this repo now includes:

- provider-to-finance seeding in `apps/web/lib/actions/ai-providers.ts`
- finance bridge services in `apps/web/lib/finance/ai-provider-finance.ts`
- finance bridge actions in `apps/web/lib/actions/ai-provider-finance.ts`
- provider detail bridge panel in `apps/web/components/finance/AiProviderFinancePanel.tsx`
- supplier detail bridge panel in `apps/web/components/finance/AiSupplierFinancePanel.tsx`
- spend summary card and dedicated AI spend workspace:
  - `apps/web/components/finance/AiSpendSummaryCard.tsx`
  - `apps/web/components/finance/AiSpendWorkspace.tsx`
  - `apps/web/app/(shell)/finance/spend/ai/page.tsx`
- schema additions in `packages/db/prisma/schema.prisma`

The core new schema concepts are:

- `AiProviderFinanceProfile`
- `SupplierContract`
- `ContractAllowance`
- `ContractUsageSnapshot`
- `FinanceWorkItem`

This restored design reflects that implemented shape.

## Design Goals

1. Seed finance ownership automatically when a provider is configured.
2. Represent AI providers as suppliers inside normal finance AP operations.
3. Track plan posture, included allowances, and contract readiness separately from raw usage.
4. Evaluate usage daily so Finance can act on underuse and critical-low situations.
5. Generate finance work items rather than leaving warnings as passive dashboard colors.
6. Support draft AP billing for fixed commitments.
7. Keep the design ready for future coworker-to-coworker governed handoff and alerting.

## Core Decision

The recommended operating model is:

- provider setup seeds a supplier and finance profile immediately
- Finance owns the commercial layer after setup
- usage is evaluated daily against contract allowances
- unused commitment and low-remaining states become finance work items
- billing stays inside existing AP controls

This is a finance-owned supplier + contract + meter tracking design, not just a spend dashboard.

## Domain Model

### AiProviderFinanceProfile

Purpose:

- the finance bridge between a technical AI provider and a finance-owned supplier relationship

Key responsibilities:

- link provider to supplier
- store finance bridge status
- store billing and usage URLs
- declare reconciliation strategy
- collect finance-facing notes and open work items

Current status model:

- `draft`
- `active`
- `needs_plan_details`
- `archived`

### SupplierContract

Purpose:

- represent the commercial commitment Finance manages for the provider

Key responsibilities:

- contract status
- contract type
- billing cadence
- contract currency
- monthly committed amount
- budget owner
- contract notes

Current contract types:

- `subscription`
- `metered`
- `hybrid`

### ContractAllowance

Purpose:

- store included usage or quota against a contract

Key responsibilities:

- metric key and scope
- included quantity
- low / critical-low thresholds
- underuse threshold
- valuation method
- explicit unit value when needed

This is the core “use it or lose it” model. A subscription contract without allowances is commercially incomplete for this feature.

### ContractUsageSnapshot

Purpose:

- persist daily usage evaluation for an allowance

Key responsibilities:

- consumed quantity
- remaining quantity
- utilization percent
- estimated unused value
- projected period-end quantity and utilization
- projected overage quantity
- data source and confidence

### FinanceWorkItem

Purpose:

- turn missing data or threshold conditions into actionable finance follow-up

Current work item types:

- `plan_details_needed`
- `billing_url_missing`
- `usage_source_missing`
- `reconciliation_review`
- `underuse_attention`
- `critical_low_remaining`

## Workflow and Lifecycle

### 1. Provider setup seeds finance ownership

When a user configures an AI provider successfully:

- provider activation still completes as normal
- Build Studio auto-configuration still runs as normal
- the platform also seeds the finance bridge:
  - `Supplier`
  - `AiProviderFinanceProfile`
  - draft `SupplierContract`
  - `FinanceWorkItem` if plan details are incomplete

This seed must not require separate finance permissions from the setup user. It is part of the setup lifecycle, not a second disconnected workflow.

### 2. Draft-to-active contract transition

Contracts start in `draft`.

They become `active` only when the minimum commercial fields are present:

- contract type
- billing cadence
- currency
- budget owner
- allowance set for subscription or hybrid plans

This keeps Finance honest about what is known versus what still needs completion.

### 3. Daily metering and evaluation

A daily evaluation job should:

- inspect active AI provider finance profiles
- inspect active supplier contracts and allowances
- resolve usage from the best available source
- write a `ContractUsageSnapshot`
- create work items for threshold breaches

Current fallback behavior in the implementation:

- when no provider-specific usage resolver is supplied, month-to-date `TokenUsage` is aggregated by `providerId`

### 4. Operational follow-up

The first slice does not depend on a full alerting queue.

Instead it records explicit finance work items for:

- missing plan details
- missing usage source
- underuse risk
- critical low remaining allowance

This preserves actionability now and keeps the event surface ready for a later messaging or alert thread.

### 5. Billing and AP

For fixed commitments:

- Finance can generate a draft `Bill` from a supplier contract for a billing period
- humans still review, approve, and pay through normal finance AP workflows

This keeps AI vendor cost under the same financial controls as every other supplier.

## UI Surfaces

### `/platform/ai/providers/[providerId]`

Keep this page technical-first, but show a Finance Bridge panel with:

- finance status
- supplier link
- contract count
- open work-item count
- billing and usage links

### `/finance/spend`

Show AI spend as a first-class finance summary card alongside bills, expenses, and suppliers.

### `/finance/spend/ai`

This is the dedicated finance workspace for AI provider commitments.

The first slice should show:

- total AI suppliers
- committed spend
- contracts needing setup
- open work items
- supplier/provider/contract/utilization overview table

### `/finance/suppliers/[id]`

When the supplier is linked to an AI provider, show AI-specific finance context:

- provider link
- bridge status
- contract counts
- open work items
- billing and usage links

## Coworker and Governance Direction

This slice is intentionally compatible with a later governed coworker handoff model.

The intended future shape is:

- provider-setup coworker seeds the technical provider
- it emits a governed finance work order
- finance coworker completes commercial ownership
- approval, delegation, and audit remain explicit

This aligns with the parallel A2A-shaped coworker runtime work, but the first slice does not require full A2A implementation.

## In Scope for Slice 1

- provider setup finance seeding
- finance bridge schema
- draft contract and allowance handling
- daily evaluation hook
- AI spend summary card
- AI spend workspace
- provider and supplier context panels
- finance work items for gaps and threshold conditions
- draft AP bill generation for commitments

## Out of Scope for Slice 1

- full provider billing API integrations across vendors
- automatic payment execution
- full alert queue / messaging implementation
- advanced forecasting across all finance domains
- full coworker handoff envelope execution
- external A2A protocol implementation

## Documentation Expectations

This feature should remain documented at three levels:

1. design and implementation intent in `docs/superpowers/specs/` and `docs/superpowers/plans/`
2. operator guidance in `docs/user-guide/finance/`
3. provider setup guidance in `docs/user-guide/ai-workforce/`

The route and feature docs should be updated whenever these surfaces change:

- `/platform/ai/providers/[providerId]`
- `/finance/spend`
- `/finance/spend/ai`
- `/finance/suppliers/[id]`

## Verification State

The current implementation was verified with:

- focused Vitest coverage for finance bridge services, actions, provider setup integration, and finance nav
- Prisma client generation
- web typecheck
- Next production build

Browser-level route QA remains a follow-up verification task.
