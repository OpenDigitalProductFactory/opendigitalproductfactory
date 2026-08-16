# Plan — Truthful AI-platform-health readout + single corrective decision (BI-150DE6FB)

**Epic:** EP-AI-OPS-AUTONOMY (facet 1, lead BI)
**Status:** draft plan · 2026-08-08
**Source evidence:** live session 2026-08-08 — sandbox flood + model-layer diagnosis. See memory `project_build_engine_lever_not_sovereignty_toggle_2026_08_08`.


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `salvage/2026-08-15/xenodochial-engelbart-8e0186` @ `b8ef95febd3c386635eec9db547903f1c3f783c4`, pinned at `refs/salvage/2026-08-15/salvage/2026-08-15/xenodochial-engelbart-8e0186` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin b8ef95febd3c386635eec9db547903f1c3f783c4:refs/heads/salvage/2026-08-15/xenodochial-engelbart-8e0186`.
> - Backlog ids cited below that do **not** resolve in this install: `BI-150DE6FB`, `BI-27C2DB38`, `BI-BEA0F80D`. Treat them as labels, not links.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## Problem (grounded)

Two concrete misreports, both traced to source:

1. **Misleading verdict.** `apps/web/lib/inference/phase-model-resolution.ts:569-573` computes the runtime verdict (`all-local | all-cloud | mixed | unconfigured`) from **only the phases that resolved** (`decided`, `cloudCount`, `localCount`). Phases that fail the hard filter (no eligible engine) are excluded from the tally, so 2 resolved-local + 3 blocked phases reports `all-local` — reading as "healthy" while builds cannot run.
2. **"Try again in 30s" for a structural block.** A `classifyDispatchFailure` classifier already exists (`phase-model-resolution.ts:247`, `structural = verdict.code !== "transient"`), but the operator/coworker banner the user saw ("temporarily unavailable, try again in about 30 seconds") is NOT gated on it — that copy is emitted elsewhere (coworker chat / generic provider-unavailable path, source TBD in Phase 1).

## Phases

### Phase 1 — Locate every surface that renders AI-runtime status (discovery)
- Grep the "temporarily unavailable / try again in about 30 seconds" copy to its source (NOT in `lib/build/inference-failure.ts`; likely the coworker-chat/provider-unavailable path). Enumerate every consumer of `resolve_model_selection` / `RuntimeVerdict` and every place the "try again" copy is produced.
- Output: a surface inventory (operator: AI Workforce / Build Runtime; coworker chat; customer: `lib/build/dispatch-attempt-customer.ts`).

### Phase 2 — Fix the verdict contract (the core defect)
- In `phase-model-resolution.ts`, add a **blocked-phase dimension** to the `RuntimeVerdict` result: count phases whose resolution failed the hard filter, and never return `all-local`/`all-cloud`/`mixed` as a bare "healthy" signal when `blockedCount > 0`. Add an explicit `phasesBlocked` field + per-phase reason already present in the phase objects.
- Distinguish **predicted-pessimistic** (engine present+healthy per `get_build_engine_readiness`, excluded only by the routing-contract prediction) from **really-blocked** (no present/healthy engine). This is shared with BI-BEA0F80D — implement the flag here, consume it there.
- TDD: unit test the 2-local + 3-blocked fixture → asserts NOT `all-local` and surfaces the blocked phases + the single corrective action. (Test-first per dpf-tdd.)

### Phase 3 — Gate the "try again" copy on the transient classifier
- Route every runtime-status surface's "try again in Ns" copy through the existing `classifyDispatchFailure` transient/structural result. Structural (no-eligible-engine, routing-contract) → show the real cause + the one corrective decision, never a retry timer.

### Phase 4 — Single corrective decision + deep link
- For each blocked phase, derive the one corrective action from the exclusion reason (e.g. "no eligible code-gen engine → pin dispatch engine to Claude Code CLI at `/platform/ai/build-studio`", or "activate a provider satisfying code-gen@internal"). Render it as a deep link to the exact control. (This is the hand-off seam to the self-healing loop BI-27C2DB38.)

### Phase 5 — Functional acceptance
- Reproduce the local-only + Auto/agentic state on the live install → readout says "3 of 5 build phases blocked: no eligible code-gen/reasoning engine" + the corrective decision, and shows NO "try again in 30s".
- Flip the dispatch engine → readout reflects the new true state; no `all-local` while any phase is blocked. Functional, not structural (per commandment).

## Neighbors / non-duplication
- **BI-BEA0F80D** (facet 3) — implements the predicted-vs-blocked flag's UI + save verify-and-confirm; this BI defines the flag at the resolver.
- **EP-VERIFICATION-INTEGRITY** — verdict trustworthiness governance; align, don't fork.
- **FB-FE63D00D** — routing self-learning no-op; independent of this BI.
