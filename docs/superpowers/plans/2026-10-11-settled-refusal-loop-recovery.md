---
status: draft
---

# Settled refusal loop recovery

Backlog: BI-PIR-d2257424. Source baseline: `30dd6aaaa85`.

## Scope and procedure

The operator authorized proceeding with the tool/authority efficiency refactor. This first bounded source repair corrects the existing in-turn circuit breaker. It does not implement a new permission model, change grants, promote GPP enforcement, or claim to prevent re-dispatch across scheduled runs.

DPF tools are absent from the current session's callable registry. Native host inventory previously established a healthy OAuth connection, but this session cannot obtain a kernel decision, workroom claim or live plan coverage. Work proceeds under AGENTS.md's explicitly authorized source-repair route and [recovery routing](../../../packages/dpf-skill-pack/skills/dpf-systematic-debugging/references/recovery-routing.md). No coordination receipt is synthesized. Reconcile this source evidence through the existing item once session attachment is restored. Source-local checks do not authorize publication bypass or runtime deployment.

## Design grounding

Reuse the existing authoritative `GOVERNED_REJECTION_DISPOSITION` in `apps/web/lib/govern/authority/governed-rejection-disposition.ts`, the existing three-refusal breaker in `apps/web/lib/tak/agentic-loop.ts`, and the existing `policy-or-capability` failure result. The [investigation](../research/2026-10-11-gpp-tool-context-efficiency-investigation.md) records the source/live distinction and existing GPP owners. This is a behavior correction within existing refusal policy, not a fresh kernel policy decision.

## Repair sequence and acceptance

1. Reproduce changing-argument refusals through `runAgenticLoop`, avoiding reliance on the identical-call detector. Existing behavior: `authority_denied` and `forbidden_capability` reach 200 attempts; `forbidden_grant` stops at three but lacks a typed failure. Observe the failing test before changing production source.
2. Resolve refusal from the executor's explicit disposition, falling back to its canonical rejection table when older results omit disposition. Do not maintain another error-code list in the loop.
3. Stop after three uninterrupted settled refusals and return the existing typed policy/capability blocker with the recorded tool/reason details. Clear the streak and its explanation on success or a non-refusal result. Keep unknown execution errors outside this classification.
4. Verify approval-pending, permit-required and unavailable checks remain distinct from refusal. Verify progress and non-verdicts separate refusal sequences.
5. Run affected tests, both TypeScript programs, deterministic local guards and diff whitespace checks. Publication remains subject to the normal DCO/PR/CI controls and reconciled coordination.

## Investment attribution

Classify this delivery as refactoring/correction of existing execution mechanics. Count it once against the canonical item when accepted; multiple tests or contributing threads do not create additional delivered work. Do not infer an actual-effort percentage from this diff. The initiative-wide 80%+ target and proposed estimate-weighted measure remain in the investigation; no metric implementation or backfill is part of this slice.

## Documentation impact and limits

The architecture's existing refusal semantics remain unchanged; this repair makes the loop consume them. Operator permission controls and routes are unchanged. This plan documents the coworker execution behavior and recovery limits; no new end-user UI is introduced. The broader nontechnical approval UX, provider attachment budgets, cross-run parking and investment dashboard remain governed follow-up work.

Live kernel/workroom/coverage, shared local-CI, served workflow verification, deployment and live retry-volume reduction are unproven until their respective gates run. A passing unit reproduction does not establish the cause of every recorded live refusal.

## Source-local evidence

- First-failing reproduction: changing-argument `authority_denied` and `forbidden_capability` each reached 200 tool attempts. The legacy `forbidden_grant` path stopped at three but returned no structured failure.
- Repair: all three refusal sequences stop at three executions and return the existing `policy-or-capability` failure. A six-call batch stops after its third refusal, retaining those three completed results without executing the remainder.
- Final affected suites: 140 tests passed across the original loop suite, the extracted refusal suite and the shared disposition suite. Success, approval-pending and inconclusive results break a refusal streak. Canonical rejection-table coverage retains `permit_required` as awaiting input.
- `pnpm --filter web typecheck:all`: production and test programs passed.
- `gate-local`: all 14 deterministic working-tree gates passed with the declared source-recovery scope; the initial oversized-test-file failure was corrected by extracting refusal tests, not raising its budget.
- Documentation links, web import-cycle guard and diff whitespace checks passed. Module-size limits are tightened only for the two modules reduced by this repair.

These are source-local results. They do not replace live coordination or runtime-bound evidence. No PR, deployment, completed backlog transition or accepted-work metric contribution is claimed.
