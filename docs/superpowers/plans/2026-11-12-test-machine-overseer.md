---
status: draft
---

# Test-machine overseer — implementation plan

**Backlog:** BI-218A4555 (umbrella; atomic). **Workroom:** WC-230F1C07.
**Design:** [`docs/superpowers/specs/2026-11-12-test-machine-overseer-design.md`](../specs/2026-11-12-test-machine-overseer-design.md) (revision 2), decision DI-2C6093E878DC.
**Coverage decision:** atomic. The phases share one policy module and one admission path. Shipping the order without the hold bound leaves the M1 go criterion unmet, and shipping the bound without the order lets a yielded holder re-take the slot at once. BI-995E9530 (preview bound) is already done and is generalised here, not re-delivered.

## Phase 1 — Pure policy (`apps/web/lib/nonprod/environment-lease-overseer.ts`)

- `classifyLease`: class, tier and hold bound from `environmentKey`, `claimKey`, `resourceClass`.
- `buildServiceHistory`: last service per session, executor and class; completed holds per class (60-minute lookback).
- `orderWaiters` / `compareByPolicy`: effective tier (30-minute aging), class turn in tier 0, virtual start time (10-minute session and 2-minute executor fair share), then `queuedAt` and id. `active-candidate` keeps first-come.
- `decideHoldBound`, `boundedRenewalExpiry`: contended means a live waiter from another session.
- `explainQueue`: position, `estimatedWaitMs`, `queueReason`, `policyVersion`.
- Tests: `environment-lease-overseer.test.ts` covers AC-OVS-1, AC-OVS-2, AC-OVS-3, AC-OVS-4, AC-OVS-5, AC-OVS-6 and AC-OVS-7.

## Phase 2 — Admission and renewal

- `planEnvironmentAdmission` orders waiters with the policy and never admits an AI turn. A live AI turn holds the free slot open.
- `reconcileEnvironmentInTransaction` reads the last hour's admissions in the same query and returns the explained queue. The claim reports policy position, estimate and reason.
- `environment-lease-hold-bound.ts` (renamed from `environment-lease-preview-yield.ts`) reads waiters only near the bound. Renewal yields past it and records `phase`, or caps the expiry at the bound.
- `durable-wait.ts` wakes the policy head.
- Tests: `environment-lease-hold-bound.test.ts`, existing lease, durable-wait and pool suites.

## Phase 3 — Local AI turns

- `apps/web/lib/nonprod/local-ai-turn.ts`: `recordLocalAiDemand` upserts one queued `inference-turn:local` row under the environment lock; `settleLocalAiTurn` closes it as served.
- `routing/local-provider-capacity.ts`: deferral by an active gate records demand; a dispatch that proceeds settles a waiting turn. Failures never change the dispatch decision.
- `change-review/semantic-review-background.ts`: a deferred review records demand.
- `queue/functions/substrate-reconciler.ts`: served turns are excluded from the local-CI stall check.
- Tests: `local-ai-turn.test.ts`, `local-provider-capacity.ai-turn.test.ts`.

## Phase 4 — Visibility

- MCP: queued claim result and message carry estimate and reason; renewal yield names the class and bound; `list_nonprod_environment_leases` adds the `overseer` view (`environment-lease-overseer-view.ts`).
- Gate client: `scripts/gate-worktree.mjs` prints estimate and reason; `scripts/lib/pregate-status.mjs` shows them under the queue position.
- Docs: build-gate runbook, delivery-surfaces runbook, `dpf-use-shared-nonprod-environment` skill.

## Verification

1. Unit: the nonprod, routing, lease-pack, semantic-review worker and substrate-reconciler suites; `node --test` for the two gate-client suites.
2. `pnpm --filter web typecheck`.
3. `pnpm gate:wait` on the branch head (shared local-CI lease).
4. After release through `request_self_upgrade`: read `list_nonprod_environment_leases` on the live install. Confirm the `overseer` view, and that no hold of a bounded class outlives its bound while another session waits (the M1 go criterion). Record what was and was not observed.

## Traceability

| Deliverable | Requirement | Acceptance | Test |
| --- | --- | --- | --- |
| Policy order | OBJ-OVS-1, OBJ-OVS-2 | AC-OVS-1, AC-OVS-2, AC-OVS-3, AC-OVS-4 | `environment-lease-overseer.test.ts` (starvation, fair share) |
| Hold bounds | OBJ-OVS-3 | AC-OVS-5, AC-OVS-6 | `environment-lease-overseer.test.ts` (bounds), `environment-lease-hold-bound.test.ts` |
| AI turns | OBJ-OVS-1 | AC-OVS-1 | `environment-lease-overseer.test.ts` (alternation, slot hold), `local-ai-turn.test.ts`, `local-provider-capacity.ai-turn.test.ts` |
| Visibility | OBJ-OVS-4 | AC-OVS-7 | `environment-lease-overseer.test.ts` (visible queue), `nonprod-lease-pack.test.ts`, `gate-worktree-pool-closed.test.mjs`, `pregate-status.test.mjs` |
| Policy-head wake | OBJ-OVS-1 | AC-OVS-8 | `durable-wait.test.ts` |
| Turn bookkeeping safety | OBJ-OVS-4 | AC-OVS-9 | `local-provider-capacity.ai-turn.test.ts`, substrate-reconciler query |
