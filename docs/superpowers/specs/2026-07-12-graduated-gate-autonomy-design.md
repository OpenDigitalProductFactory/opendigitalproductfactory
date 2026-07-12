# Graduated gate autonomy — risk-graduated Build Studio phase gates

- **Status:** phase 1 implemented (plan-advance graduation, opt-in); ideate-start + ship gates specified
- **Date:** 2026-07-12
- **BI:** BI-D996C238 · **Epic:** EP-0AF96937
- **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §7/§9-R7

## Problem

The only WWMD-governed Build Studio transition is plan→build, and it hardcodes `riskTier="medium"` for every build (`build-studio-gate.ts`). That is neither graduated nor extensible:

1. **Not graduated.** A cosmetic copy change and a change to the decision kernel face the *same* confidence bar. The 2026 consensus is graduated autonomy — auto-proceed for low-risk well-evidenced transitions, human review for high-risk — keyed to what the change touches.
2. **Not extensible.** ideate-start and review→ship are doctrine-blind (mechanical), so there is nowhere to place "auto-ship a low-risk change; escalate a risky one."

## Design

`apps/web/lib/decision-perspective/graduated-autonomy.ts` — pure, unit-testable core:

- **`deriveTransitionRiskTier({sensitivity, transition})`** maps `(deliverable sensitivity × transition consequence)` → a `DecisionRiskTier`. Base by sensitivity (low→low, elevated→medium, high→high); transition bump (`ship`+1, `plan-advance`+0, `ideate-start`−1); **floors** — high sensitivity never drops below `high` (so the evaluator's escalate-on-high/critical guarantee always fires), and `ship` never drops below `medium` (shipping code is never low-risk). Result: a low-sensitivity ship is `medium` (can clear the ladder), an elevated ship is `high` (always escalates), a high-sensitivity anything is `high`+ (always escalates).
- **`graduatedGateOutcome(outcomeType)`** is the single definition of "allowed": `recommend`/`arbitrate` → auto-proceed; `escalate`/`defer` → human. Centralizes the `allowed = recommend|arbitrate` logic the gate currently inlines.
- **`isAutonomyCandidate(riskTier)`** — true only at ≤ medium (below the always-escalate floor).

## Phase 1 (this PR) — plan-advance graduation, opt-in

`evaluateBuildStudioPlanAdvancementGate` now accepts an optional `riskTier` (default `"medium"` — **byte-identical** to before). Under `DPF_BUILD_GRADUATED_GATE_AUTONOMY` (`isGraduatedGateAutonomyEnabled`, default **off**), the caller in `actions/build.ts` derives the deliverable sensitivity from the build text (`deriveDeliverableSensitivity`) and passes `deriveTransitionRiskTier({sensitivity, transition:"plan-advance"})` — fail-open to `undefined` (→ the medium default) so a derive/config error never changes the gate. Net effect when enabled: a **low**-sensitivity plan advance runs at `low` risk (easier to clear), an **elevated** one stays `medium` (unchanged common case), a **high**-sensitivity one runs at `high` and always escalates.

## Phase 2 (specified) — ideate-start and ship gates

The same evaluator + `deriveTransitionRiskTier` extend to two more transitions, each mirroring the plan gate's resolve→evaluate→persist→outcome shape with its own `phaseFrom/phaseTo` idempotency key:

- **ideate-start gate** (`transition:"ideate-start"`) — a lightweight consult before a draft starts ideate; lowest bar (bump −1). Advisory first; auto-approve draft-start when the ladder recommends at ≤ medium.
- **ship gate** (`transition:"ship"`) — the consequential one. It gates review→ship: `graduatedGateOutcome(auto-proceed)` at `low`/`medium` risk auto-ships (replacing the "one remaining human click" for genuinely low-risk changes), while anything the ladder escalates — and everything at `high`/`critical`, which includes every elevated-or-higher ship by the floors above — still routes to the operator. This is the prerequisite the one-shot feature lane (BI-417AE8E9) composes.

Both Phase-2 gates land behind their own default-off flags and fail-closed (any error → escalate), consistent with the existing gate. They are specified here, not wired in this PR, because removing a deliberate human ship gate warrants its own focused review; the pure risk/outcome core they depend on is landed and tested now.

## Verification

`graduated-autonomy.test.ts` (7) — the sensitivity×transition tier matrix incl. the high-sensitivity and ship floors and the elevated/plan-advance byte-compat case; `graduatedGateOutcome` (recommend/arbitrate proceed, escalate/defer human); `isAutonomyCandidate`. All pass locally. The DB-backed `build-studio-gate` path is exercised in CI (its suite imports the generated Prisma client); the plan-advance change defaults to the prior `"medium"` behavior when the flag is off.

## Non-goals

Does not change the evaluator ladder itself (escalate-on-high/critical, confidence math). Does not auto-ship or auto-start in this PR (Phase 2). Sensitivity derivation reuses the existing `deriveDeliverableSensitivity` heuristic — no new classifier.
