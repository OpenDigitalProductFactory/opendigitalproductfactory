---
title: Automatic Work Capsule change-impact contract
date: 2026-08-08
status: active
backlog: BI-A7407F49
epic: EP-WORK-CONVERGENCE
work_capsule: WC-36B69D5D
decision_interaction: DI-9C50C9F185C4
---

# Automatic Work Capsule change-impact contract

**For agentic workers:** claim exact edit paths before implementation. The
claim response is the start-of-work contract: consume its resolved test and
guard obligations before writing the first failing test or source change. An
`unresolved` contract means expand verification and investigate; it never
means that no verification is needed.

## Outcome

Move deterministic test and guard discovery from the end of a change to the
mandatory Work Capsule scope-claim seam. Every edit-path claim will derive a
versioned change-impact contract from the existing gate-context generator,
persist it in `WorkCapsule.verificationState`, add an operator-visible capsule
activity, and return it to the caller immediately. Repeated claims refresh the
contract from the capsule's complete edit-path set.

This is prevention guidance, not a replacement for CI. Read-only claims do not
produce a contract. Generator failure is recorded and returned as
`unresolved`, preserving the exhaustive verification default.

## Design grounding

Existing specifications reviewed were the 2026-07-29 gate-context pack plan and
the 2026-07-27 CI evidence planner. The implementation extends, rather than
duplicates, the current substrate:

- `scripts/lib/gate-context.mjs`, the deterministic prospective diff-to-gates
  generator;
- `apps/web/lib/integrate/gate-context-bridge.ts`, the existing portal-to-host
  adapter;
- `WorkCapsule.scopeClaims`, `verificationState`, and
  `WorkCapsuleActivity`, the existing coordination and evidence substrate;
- `POLICY_GUARD_PROFILES`, prose/style baselines, and the source graph's
  `TESTED_BY` relationships as canonical guard/test inventories.

The source of truth remains the Work Capsule for scoped work and persisted
verification guidance, while gate profiles, CI evidence policy, and source-graph
relationships remain the canonical inventories used to derive that guidance.

WWMD interaction `DI-9C50C9F185C4` selected **automatic-scope-contract** with
high confidence (composite 4.8492, margin 2.1729). It rejected an
instruction-only reminder because agents can omit it, and deferred a new hard
lifecycle gate/model because the existing capsule state can carry an explicit
resolved/unresolved contract with lower blast radius.

## Research and benchmarking

- **Nx affected** derives tasks from the changed project graph before work;
  DPF adopts the same early, dependency-aware posture while keeping its own
  gate and Work Capsule contracts.
- **Vitest related/changed** can identify static-import-related tests; DPF
  treats this as advice and keeps exhaustive fallback for dynamic, missing, or
  stale relationships.
- **GitHub merge queue** validates the final merge group; DPF retains that
  authoritative backstop while moving deterministic obligations earlier.

Rejected: a new parallel impact table, a second guard registry, and any rule
that equates missing impact evidence with permission to skip tests.

## Backlog coverage

- Decision: `atomic`
- Parent: `BI-A7407F49`
- Receipt: `cmsl0f7hz092f01o20e6odgg0`
- Rationale: the generator contract, Work Capsule persistence/response, and
  process guidance are one behavior. Shipping any part alone would either
  create advice no surface consumes or instructions for data the capsule does
  not yet produce.
- `impact-contract` — not independently shippable; dependencies: none.
- `capsule-integration` — not independently shippable; depends on
  `impact-contract`.
- `process-adoption` — not independently shippable; depends on both prior
  phases.

## Phase 1 — test-drive prospective verification obligations

Extend `scripts/gate-context.test.mjs` first so a planned UI/source edit names
the relevant prose/style guards and a test-impact action before generation.
The core must derive guard commands/names from `POLICY_GUARD_PROFILES` and
checked-in baselines rather than create another handwritten inventory.

Extend the bridge with a typed JSON result. It must distinguish a successfully
computed context from an unavailable/invalid generator result.

## Phase 2 — persist and return the capsule contract

Test `claimWorkCapsuleScope` and `claim_capsule_scope` before changing them:

1. edit-path claims compute from the full combined path set;
2. a resolved contract is stored under
   `verificationState.changeImpactContract` and recorded as a
   `change-impact-planned` activity;
3. repeated claims replace the contract with the refreshed full-scope result;
4. read-only claims leave the contract untouched;
5. generator failure stores and returns `status: unresolved` with an
   exhaustive-verification instruction;
6. the MCP result exposes the contract alongside the renewed capsule.

Keep impact generation outside the transaction, then pass the immutable
result into the store so the scope, verification state, and activity are
written atomically. No Prisma migration is needed.

## Phase 3 — make consumption part of normal work

Update the canonical `dpf-writing-plans` and `dpf-tdd` skills so planning and
Red begin by consuming the capsule's recorded impact contract. Update CI
evidence documentation and reconcile the historical gate-context plan's stale
backlog references with live `BI-A7407F49` without rewriting history.

## Completion gate

1. Gate-context tests prove early guard/test obligations and deterministic
   output.
2. Bridge tests prove typed JSON parsing and fail-safe unresolved behavior.
3. Work Capsule store/handler tests prove persistence, refresh, read-only, and
   caller-response contracts.
4. Affected package tests, production build, documentation guards, and the
   complete governed pregate pass.
5. Exact merged-code verification passes before push; semantic review is
   clean; `pnpm pr:health` is terminal/pass before merge-queue enrollment.

UX and migration gates are not applicable: this changes agent coordination
and developer evidence, not an operator-facing page or database schema.
