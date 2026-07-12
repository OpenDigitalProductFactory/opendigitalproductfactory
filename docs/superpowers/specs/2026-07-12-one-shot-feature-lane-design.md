# One-shot feature lane — single-pass governed dispatch for the low-risk tail

- **Status:** eligibility core implemented (opt-in); single-pass dispatch + auto-ship compose the phase-2 ship gate
- **Date:** 2026-07-12
- **BI:** BI-417AE8E9 · **Epic:** EP-27FD96BC · **Depends on:** BI-D996C238 (graduated gate autonomy)
- **Strategy:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §3/§9-R3

## Problem

The user's cost goal is to **one-shot new features** (not whole products) while holding quality. Every DPF build today takes the full multi-round lane (ideate → plan → multi-round review → build → review → ship) regardless of how small and low-risk it is — the dominant cost for the long tail of small changes. The 2026 evidence (Stanford greenfield/brownfield split; Ralph-loop economics) is that a single-pass build is safe **only** when success is machine-checkable and the change is low-stakes. So a one-shot lane must be *narrow by construction*, not a blanket autonomy increase.

## Design

`apps/web/lib/build/one-shot-lane.ts` — pure, unit-testable:

- **`isOneShotEligible(input)`** is true iff **all** hold: work type is `feature`/`fix`; size is `small`/`medium`; deliverable sensitivity is `low`; the graduated gate **auto-proceeds** (`graduatedGateOutcome(gateOutcome).autoProceed`, from BI-D996C238); and the **oracles are green** (typecheck + tests pass in the sandbox). Any single failure disqualifies — **fail-safe** to the standard lane, never fail-open.
- **`oneShotLaneDecision(input)`** returns `{lane, reason}`, naming the first failing precondition so the operator sees *why* a build stayed on the full lane.

The lane composes existing primitives rather than inventing autonomy: sensitivity from `deriveDeliverableSensitivity`, the auto-proceed decision from the graduated gate, and the oracles from the sandbox typecheck/test the build gate already runs. It only narrows **where** the graduated ship gate's auto-proceed is allowed to skip ceremony.

## Wiring & flag

Gated by `DPF_BUILD_ONE_SHOT_LANE` (`isOneShotLaneEnabled`, default **off**). When enabled and `oneShotLaneDecision` returns `one-shot`, the build pipeline:
1. **skips the multi-round deliberation** — a single specialist pass, verified by the oracles;
2. **auto-ships** via the phase-2 graduated **ship gate** (specified in the graduated-gate design) instead of parking for the operator's manual ship click.

Both effects require the phase-2 ship gate; this PR lands the **eligibility core + flag + decision/reason logic** so the lane's gating is defined, tested, and inspectable. The pipeline consult (attach `oneShotLaneDecision.reason` to the build's evidence, then branch dispatch) is the follow-up that composes the ship gate — kept out of this PR because auto-ship removes a deliberate human gate and is landing under the graduated-gate phase-2 review.

## Verification

`one-shot-lane.test.ts` (10) — the ideal case and every disqualifier (large/xlarge, non-feature/fix, non-low sensitivity, red oracles, non-auto-proceed gate, missing fields), plus `oneShotLaneDecision` lane + first-failing-reason and the fail-safe default. All pass locally.

## Non-goals

Not a one-shot of a whole product (explicitly out of scope — DPF one-shots *features* inside a durable org codebase). Does not widen the graduated gate's risk floors (high sensitivity still escalates). Does not change any build when the flag is off. The single-pass dispatch mechanics and the auto-ship wiring land with the phase-2 ship gate.
