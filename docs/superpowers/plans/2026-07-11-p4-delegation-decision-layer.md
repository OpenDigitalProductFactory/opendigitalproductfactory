# P4 — Delegation & altitude decision layer

- **BI:** BI-8167C9CD · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no architecturally-distinct options to weigh — a deterministic priority policy over existing primitives; the ordering itself is the design.

## Problem (from the audit)

Every delegation primitive already exists — `request_coworker` (hand to a named peer), `spawn_work_thread` / `start_deliberation` (fan out), and escalation — but **nothing decided among them**. The model chose blindly, `hitlTierDefault` was inert metadata, and no policy related a task's altitude to who should do it. So a coworker either flailed inline on work above its altitude or never delegated at all.

## Approach — a priority policy over the existing primitives

Substrate-verify-first: no new primitive, store, or table. This adds the missing decision layer and wires `hitlTierDefault` as a real runtime input.

1. `apps/web/lib/tak/delegation-policy.ts` (new, pure): `decideDelegation(signals) → {mode, reason}` with a strict priority order — depth-cap → escalate (high altitude under tight oversight, HITL ≤ 1) → request_coworker (capability gap) → fan_out (high-effort + decomposable) → inline. `renderDelegationGuidance` turns a non-inline decision into a one-block prompt hint that names the recommended primitive and its reason.
2. `apps/web/lib/actions/agent-coworker.ts`: at the per-turn warrant point, load the agent's `hitlTierDefault` (0=human-only … 3=autonomous) and compute the decision from the warrant's altitude. Surface escalate guidance when warranted, and for other high-effort turns a short delegation menu — so the coworker **chooses** with a reason. `capabilityGap` / `decomposable` are the model's judgment (it knows the task), so it gets the primitive menu rather than a forced pre-turn choice. Advisory — never blocks the turn.

## Verification
- Unit (`delegation-policy.test.ts`): each priority branch (inline / escalate / request_coworker / fan_out / depth-cap) and their precedence; the guidance renderer names the mode, reason, and primitive.
- Typecheck clean.

## Non-goals (honest follow-ups)
- **Auto-executing** the delegation (calling the primitive for the model) — deliberately kept as guidance so the coworker retains the final call; auto-execution is a separate, riskier slice.
- Deriving `capabilityGap` / `decomposable` from static signals — the model judges these per-task; a future consult-tool could let it re-run the policy with those set.
