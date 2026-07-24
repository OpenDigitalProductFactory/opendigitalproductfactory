---
title: Remove avoidable failure opportunities
slug: remove-avoidable-failure-opportunities
pageKind: principle
status: published
abstract: The cheapest failure is the one the system can no longer express. Remove avoidable failure modes structurally — make the wrong state unrepresentable or auto-detected — instead of relying on a human or an AI to stay vigilant. Self-heal what you can; make the residual, unavoidable failures loudly observable. Drift control as a designed-in property, not a maintenance chore, is one of DPF's differentiating benefits.
principleTier: core
principleDirection: Remove avoidable failure modes structurally and keep correctness through automated, self-checking process — not human or AI vigilance; make the residual, unavoidable failures loudly observable.
principleDimensionVector: {"long_term_maintainability": 1.0, "human_cognitive_load": -0.6, "evidence_density": 0.6, "governance_compliance": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleRingScope:
  - universal-ring
principlePublic: false
authoredAt: 2026-06-14
authoredBy: mark-bodman
---

# Remove avoidable failure opportunities

**The cheapest failure is the one the system can no longer express.**
Before you write the code that catches a mistake, ask whether the mistake
can be made *unrepresentable* — designed out of the system so it cannot
occur, rather than detected after it does. When prevention isn't possible,
make the system *self-heal*. When neither is possible, fall back to the
residual leg: make the unavoidable failure loudly observable.

This is **systemic prevention over vigilance.** A failure mode that depends
on a human — or an AI agent — *remembering* to do the right thing every
single time will eventually fail, because vigilance does not scale and
does not compound. A failure mode the architecture forbids cannot recur.
The work is to keep moving correctness out of the "someone must remember"
column and into the "the system guarantees it" column.

## What "removing the failure opportunity" looks like

- **Make the wrong state unrepresentable.** A `string` that should be one
  of four values is a typo waiting to happen; a string-literal union or
  enum makes the typo a compile error. The failure opportunity is deleted,
  not guarded. (See [[principles/strongly-typed-string-enums]].)
- **Derive, don't duplicate.** Two hand-maintained copies of the same fact
  drift the instant one moves. A single source of truth that the other
  view is *projected from* cannot drift by construction — the second copy
  no longer exists to be wrong. (See [[principles/single-source-of-truth]]
  and [[mirror-dont-migrate]].)
- **Fix the seed, then guard the invariant.** A config regression that
  keeps coming back means the bootstrap data was never corrected. Patch
  the seed so the bad state can't be born, and add a guard that fails the
  build if it ever reappears. (See [[principles/fix-the-seed-not-the-runtime]].)
- **Default-deny, then grant explicitly.** A permission surface that is
  permissive-by-default fails open on every new tool nobody remembered to
  lock down. Deny-by-default fails closed; the only way to grant is to say
  so, on the record.
- **Automate the check at the point work enters the system.** A drift gate
  in CI, a build gate at the Review phase, and the agent skill that runs
  the same gate — one check, three consumers — means no one has to
  *remember* to verify parity. The system verifies it, every time.

## Why this exists

**Drift is the tax on complexity, and most of it is avoidable.** As a
system grows, design and implementation pull apart: the model says one
thing, the code says another, and the gap widens silently until the
architecture is fiction. The naive fix is to ask people to keep the two in
sync by hand — which relocates the cognitive load instead of removing it,
and rots on arrival.

The Design–Implementation Parity Engine is this principle made concrete.
Its very first run — a read-only gate that re-checks every
deterministic-provenance `sourceKey` in the architecture views against real
code — caught a real broken reference (`data-model-mirror-apply.ts` missing
its directory prefix) that a human reviewer would not have found by reading.
The hand-authored model had already drifted; the *system* caught it because
the check was automated, not because anyone was vigilant. That is the whole
argument in one data point: **the gate finds what the human eye skips, and
it finds it every run, at zero ongoing human cost.**

This is also a differentiator, not just hygiene. Keeping design and
implementation in provable parity — drift control as a designed-in property
of the platform — is one of DPF's core differentiating benefits. A platform
that *cannot* drift by construction is worth more than one that merely
documents that it shouldn't.

The vigilance alternative fails three predictable ways:

1. **It does not scale.** Every new tool, route, persona, or seed row adds
   another thing someone must remember to keep correct. The remembering
   surface grows without bound; attention does not.
2. **It does not compound.** A manually-maintained invariant is re-paid in
   full on every change. A structurally-guaranteed invariant is paid once,
   at design time, and stays paid.
3. **It fails silently.** The failure that depends on vigilance is, by
   definition, invisible until someone notices the thing that should have
   happened didn't — which is exactly the failure mode
   [[make-silent-failures-observable]] exists to cover.

## The three legs

This principle is a layered defense, strongest leg first:

1. **Prevent structurally** — make the failure mode unrepresentable
   (types, single source of truth, default-deny, derivation over
   duplication). The failure cannot occur.
2. **Self-heal automatically** — when the failure *can* occur, let the
   system detect and correct it without a human in the loop (idempotent
   reconcilers, revive-on-conflict, scheduled re-projection). The failure
   occurs but does not persist.
3. **Make the residual observable** — for failures that are genuinely
   unavoidable, emit a structured, queryable signal so the failure is
   loud, attributable, and fixable. This is the residual leg, owned by
   [[make-silent-failures-observable]]; this principle sits above it and
   says: *get to this leg as rarely as possible.*

A design that reaches for leg 3 where leg 1 was available has not removed
the failure opportunity — it has merely instrumented it.

## How to apply

Before merging a change, walk the legs in order:

1. **Name the failure mode.** What is the specific wrong state this code
   could end up in — the typo, the drifted copy, the forgotten grant, the
   stale seed?
2. **Try to delete it (leg 1).** Can a type, an enum, a single source of
   truth, a derived projection, or a default-deny make that wrong state
   impossible to represent? If yes, do that instead of writing a guard
   around it.
3. **If it can still occur, automate the catch (leg 1.5/2).** Add the
   invariant guard, the idempotent reconciler, or the CI/Build-Studio gate
   that detects or repairs it without anyone remembering to look. Verify
   the gate actually fails on the bad state — a gate that never goes red is
   [[structural-verification-is-not-functional|structural theatre]].
4. **For the irreducible residual, make it observable (leg 3).** Emit the
   structured signal per [[make-silent-failures-observable]] and, if it
   represents future work, file the tracking item in the same change.
5. **Remove the maintenance surface you replaced.** When a gate or
   projection makes a hand-maintained artifact redundant, delete the
   artifact in the same change — don't leave the drift-prone copy alongside
   its replacement.

The test of whether you applied this principle: after the change, is there
*less* for a human or an AI to remember, or more? Removing a failure
opportunity should shrink the vigilance surface, never grow it.

## Interface surface is failure surface

**Every interactive control is a failure opportunity.** A new button is a new
path that can be taken at the wrong time; a new fillable field is a new way to
enter an invalid, ambiguous, or malicious value — a new thing to validate, a
new column to keep honest, and a new decision the operator must understand
before acting. Interface surface is therefore *governed* surface: **any new or
changed button or fillable field is subject to evaluation against this
principle, and retiring one is, all else equal, the better move.**

This is not "every new control is bad." It is "a new control must *earn its
surface*" — the cost it adds (a thing to learn, validate, and maintain forever)
has to be outweighed by the outcome it unlocks and the breadth of reuse it
serves. Surface added without that justification is a failure opportunity taken
on for nothing.

### How a UI-surface change scores

When a change touches interface surface, score it against the cost axes
(`human_cognitive_load` above all) on this rubric — research and evidence are
what move it up:

- **No-op** — the change touches no button, field, form, or route. The
  interface dimension does not apply and contributes nothing either way.
- **High** — a **clarification interaction that produces a demonstrably better
  outcome**, **reusable across multiple internal outcomes long-term**, backed by
  research/evidence for why the surface is needed. A control that disambiguates
  intent and pays back across many flows earns its surface; it *reduces* net
  cognitive load even though it adds a control.
- **Mid** — a well-thought-out, justified interface that serves a single or
  narrow outcome with little reuse. Sound, but the surface is amortized thinly.
- **Low** — new surface with **inadequate justification or research**. The cost
  is real and the payback is unevidenced; this is surface bloat and scores
  against the principle.
- **Removal** — a change that *retires* surface (collapses two fields into one
  derived value, replaces a button with an automatic step, deletes a route
  nobody needs) scores most favorably: it is the cleanest way to shrink the
  failure surface.

The justification is the load-bearing input: the *same* new field scores
**high** when research shows it clarifies a high-traffic decision and will be
reused across archetypes, and **low** when there is no evidence it is needed —
"we might want it" is not justification. Prefer making the wrong value
unrepresentable over adding a field plus a validator
([[principles/strongly-typed-string-enums]]); prefer one automatic step over a
button the operator must remember to press
([[principles/zero-click-provider-setup]]).

## Decision dimensions

The signed `principleDimensionVector` (proposed; see the calibration note):

- `long_term_maintainability: 1.0` — this principle *is* the
  maintainability axis. Structural prevention is what keeps a system
  correct as it evolves. Maximum positive weight.
- `human_cognitive_load: -0.6` — explicitly negative. In the scorer,
  option feature scores are non-negative ("how much does this option
  exhibit this axis"), so a negative weight means an option that *adds*
  human/AI upkeep aligns *against* this principle. Removing the vigilance
  burden is central here — more central than to the residual-leg sibling
  [[make-silent-failures-observable]] (`-0.3`), so the magnitude is larger.
- `evidence_density: 0.6` — automated, self-checking process emits governed
  evidence (drift findings, gate results, conformance issues) as a byproduct
  of prevention. Positive.
- `governance_compliance: 0.4` — parity gates and default-deny surfaces are
  how the platform stays provably within its own rules. Positive.

## Anti-patterns

- **A code comment instead of a constraint.** "Remember to update the
  other copy when you change this" is a failure opportunity with a sticky
  note on it. Derive the second copy or make the divergence a build error.
- **A guard you never test going red.** An invariant check that has never
  failed might be checking nothing. Prove it catches the bad state.
- **Catch-and-continue that hides the bad state.** `try { … } catch {}`
  around the thing that can drift converts a removable failure into a silent
  one — the opposite of every leg.
- **Relocating the load and calling it removed.** Replacing "remember to
  run the script" with "remember to read the dashboard" has not removed the
  vigilance burden; it has renamed it.
- **Instrumenting a failure that leg 1 could have deleted.** Reaching
  straight for observability when a type or a single source of truth would
  have made the failure impossible.

## Related principles

- [`make-silent-failures-observable`](make-silent-failures-observable.md) —
  the residual leg. This principle says *remove the failure*; that one says
  *when you can't, make it loud.* They are paired: prevention first,
  observability for the irreducible remainder.
- [`single-source-of-truth`](single-source-of-truth.md) — drift's root
  cause is duplicated authority; collapsing copies into one derivation is
  the most common way to delete a failure mode.
- [`fix-the-seed-not-the-runtime`](../../../professions/data-architect/wiki/fix-the-seed-not-the-runtime.md) — patch
  where the bad state is born plus an invariant guard, so the regression
  cannot return.
- [`live-state-over-seed-data`](../../../professions/data-architect/wiki/live-state-over-seed-data.md) — seed is
  bootstrap; runtime truth comes from live probes, so the seed cannot be
  load-bearing where it would drift.
- [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md)
  — a gate that compiles is not a gate that catches; verify the check
  actually fails on the failure it claims to prevent.
- [`architecture-over-shortcuts`](architecture-over-shortcuts.md) — the
  quick fix is usually a new special case, i.e. a new failure opportunity;
  the sound fix removes one.

## Spec references

- [Design–Implementation Parity Engine design](../../../superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md) — §1 (drift as the tax on complexity), §8 (this principle's promotion record and proposed vector/tier)
- [Self-Maintaining Data Architecture design](../../../superpowers/specs/2026-06-06-data-architecture-self-maintenance-design.md) — the auto-extraction / mirror pattern that removes the hand-maintenance surface
