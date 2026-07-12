# P2 — Spend-aware agentic loop + the 95% downgrade

- **BI:** BI-E8BCA547 · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — closing a measured-but-unacted signal with the existing router; capability-safe by construction.

## Problem (from the audit)

The per-agent daily budget gate (`budget-gate.ts` + `ai-inference.ts`) MEASURED spend and, at 95%, wrote a `warning_95` event — but nothing acted on it. The promised "downgrade to a routine-tier model" was a comment; the `downgrade` `BudgetEventKind` was defined and **never written**. So an agent near its budget kept routing to the same expensive model until it hit 100% and was hard-rejected — a cliff, not a taper.

## Approach — bias the budget class, let the router pick

Substrate-verify-first: reuse `checkAgentBudgetFromRegistry`, the existing `budgetClass` routing lever, the router's capability floors, and the already-defined `downgrade` event. No new store, no mid-inference model surgery.

1. `apps/web/lib/inference/spend-aware-routing.ts` (new, pure): `spendAwareBudgetClass(current, status)` — `warning_95 → minimize_cost`, `warning_80 → one notch cheaper`, `ok`/`rejected` → unchanged. **Only the class changes**, so the router still honours every capability floor (min tier, tool-use, vision, context) — a near-budget turn routes to the cheapest *capable* model, never a broken one.
2. `apps/web/lib/tak/agentic-loop.ts`: once per turn (right after the route config resolves), check the agent's live spend, bias the class, log the downgrade, and write the `downgrade` budget event. Advisory — any failure leaves the class untouched and never blocks the turn.

## Why not swap the model mid-inference
The `warning_95` branch in `ai-inference.ts` has `modelId`/`providerId` already resolved; swapping there risks dropping a capability the turn needs (tools, vision). Biasing the class *before* routing keeps the capability-floor guarantee intact.

## Verification
- Unit (`spend-aware-routing.test.ts`): ok leaves the class; warning_95 forces minimize_cost from any class; warning_80 steps one notch (and can't go below minimize_cost); never raises; unknown class coerces safely.
- Typecheck clean. Behavioral: an agent past 95% of its daily limit logs a `spend-aware downgrade … -> minimize_cost` and an `AgentBudgetEvent{kind:"downgrade"}` appears.
