# Plan — Canonical Lifecycle Grammar (BI-E55991E9)

**BI:** `BI-E55991E9` (Workstream 0, FOUNDATIONAL) · **Epic:** `EP-VSL-SURFACE`
**Spec:** [2026-08-15-canonical-lifecycle-grammar-design.md](../specs/2026-08-15-canonical-lifecycle-grammar-design.md)
**Date:** 2026-08-15 · **Branch:** `feat/vsl-lifecycle-grammar`

## Goal

Add the CSDM Stage → in-stage State → advancement-gate layer on top of the existing Unified Lifecycle Backbone, so every lifecycle reports two-axis (count-by-stage AND state-within-stage) and gates advancement on an exit-ready state — without inventing a parallel lifecycle machine. This is the foundation the other four EP-VSL-SURFACE BIs express their stages through.

## Phases (all landed in this one atomic BI — see spec Backlog Coverage)

1. **Pure engine** — `apps/web/lib/lifecycle-grammar.ts`: `StageState`/`LifecycleStageDef`/`LifecycleGrammar` types, `LIFECYCLE_HEALTH_BANDS`, `validateGrammar`, `canAdvance` (the gate), `summarizeLifecycle` (two-axis rollup). No server imports.
2. **Declared grammars + resolvers** — `apps/web/lib/lifecycle-grammars.ts`: `customer-account` (9-status native decomposition), `opportunity` (lifts `STAGE_EXIT_CRITERIA`/`STAGE_STALE_THRESHOLDS_DAYS`), plus `backbone` (advancesTo derived from `LIFECYCLE_STAGE_TRANSITIONS`), `tech-currency`, `ovsm` declared and validated. `LIFECYCLE_GRAMMAR_KINDS` registry (F1 write-path vocabulary).
3. **Event-ledger state axis** — migration `20260815000000_add_lifecycle_event_state_axis` adds nullable `LifecycleEvent.fromState/toState` (open per-grammar key, not a canonical enum).
4. **Grammar-aware writer + read-model** — `apps/web/lib/lifecycle/lifecycle-transition.ts`: `recordLifecycleTransition` (validates via `canAdvance`, widened kind vocabulary, coexists with `baseline-projector`) + `getLifecycleSummary`.
5. **Behaviour-preserving CRM rewire** — `pipeline-inspector.ts` now sources exit-criteria/stale-thresholds from `OPPORTUNITY_GRAMMAR`; existing tests unchanged and green.
6. **Tests** — `lifecycle-grammar.test.ts` (22), `lifecycle-transition.test.ts` (5, DB-free guard paths), `pipeline-inspector.test.ts` (regression, unchanged).

## Verification

- Unit: `pnpm exec vitest run lib/lifecycle-grammar.test.ts lib/lifecycle/lifecycle-transition.test.ts lib/crm/pipeline-inspector.test.ts` — all green (27 + 5).
- Typecheck: `pnpm typecheck` clean.
- Migration applies cleanly (additive nullable; backfill-free).
- Local merged-CI gate before push.

## Backlog Coverage

Atomic: engine + grammars + migration + writer/read-model + the two proving resolvers are one indivisible substrate slice (spec §Backlog Coverage). The other four EP-VSL-SURFACE BIs consume this and ship independently.
