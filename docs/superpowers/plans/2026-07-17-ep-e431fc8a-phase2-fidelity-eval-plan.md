# EP-E431FC8A Phase 2 — measured tool-fidelity + intent taxonomy

**Epic:** EP-E431FC8A · **BI:** BI-DF3092F4 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md` (§6, §7 P2)

## Goal

Replace the Phase-1 fail-safe default (every unmeasured local model cliff-capped at ~15) with a **measured** tool-selection-fidelity signal, and make intent classification **data-driven** so the evidence gate, the fidelity harness, and Phases 3–4 read from one taxonomy instead of ad-hoc keyword lists.

## Design grounding

Existing specs/plans reviewed (via search_specs_and_plans): docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md and docs/superpowers/plans/2026-07-17-bi-b5c358b1-tool-selection-failsafe-plan.md. Current code substrate reviewed: apps/web/lib/actions/coworker-tool-budget.ts (Phase-1 `measuredToolFidelityCeiling` hook), apps/web/lib/tak/evidence-requirement.ts, apps/web/lib/tak/context-economy-metrics.ts (`computeToolSelectionAccuracy`), apps/web/lib/routing/eval-runner.ts (`profileConfidence` promotion), packages/db/prisma/schema.prisma (`ModelProfile.customScores` Json — no migration needed).

Design-Grounding-Decision: extends the EP-E431FC8A spec (§6); no new contract — samples live in the existing `ModelProfile.customScores` Json column and feed the existing Phase-1 cap hook; intent classification moves from an inline heuristic to a data registry. Coworker authority untouched (INV-3).

## What shipped

1. `apps/web/lib/routing/tool-fidelity-policy.ts` — pure. `deriveMeasuredToolCeiling(samples)` returns the largest surface size with measured accuracy ≥ threshold (default 0.9) and ≥ min sample count; `null` → keep the Phase-1 fail-safe. `readToolFidelitySamples` / `mergeToolFidelitySample` (running mean) for `ModelProfile.customScores`.
2. `apps/web/lib/tak/intent-taxonomy.ts` — pure. `TASK_CLASSES` registry (route prefixes, authoritative tools, cues) + `classifyTaskClass`. One source of truth for backlog-status / provider-health / capsule-status.
3. `evidence-requirement.ts` — now consults `classifyTaskClass` first (data-driven), Phase-1 heuristic as fallback; exposes the class's authoritative tools.
4. `apps/web/lib/routing/tool-fidelity-harness.ts` — pure scorer over a golden set (injected inference), producing the per-surface-size fidelity curve.
5. `apps/web/lib/routing/local-tool-fidelity.ts` — `resolveLocalToolFidelityCeiling()` (reads active local profiles' samples → measured ceiling) + `persistToolFidelitySamples()` (writes the curve back). Wired into `agent-coworker.ts` `deriveCoworkerToolCap`.

## Verification

- `pnpm --filter web exec vitest run lib/routing/tool-fidelity-policy.test.ts lib/routing/tool-fidelity-harness.test.ts lib/tak/intent-taxonomy.test.ts lib/tak/evidence-requirement.test.ts lib/tak/agentic-loop.test.ts lib/actions/coworker-tool-budget.test.ts`
- `pnpm --filter web typecheck && pnpm --filter web build`

## Non-regression

An unmeasured local model returns `null` → Phase-1 fail-safe cliff (unchanged). Cloud turns (null served context) stay at 48. Only measured evidence lifts the cap.

## Out of scope (follow-on)

The live fidelity RUNNER that drives a real local model through the harness at each surface size and calls `persistToolFidelitySamples` is an operator/eval-runner action (it needs live inference, not CI). The mechanism, storage, and cap integration are complete and tested here. Phases 3 (capability broker, BI-FB0A5C82) and 4 (specialist MoE, BI-17ACD329) build on this taxonomy.
