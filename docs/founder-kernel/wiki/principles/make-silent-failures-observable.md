---
title: Make silent failures observable
slug: make-silent-failures-observable
pageKind: principle
status: published
abstract: Every "nothing happened" code path must emit a structured signal — a log line, a typed return value, a tracking record. A silent no-op is invisible work; invisible work is undebuggable, untrackable, and erodes operator trust.
principleTier: core
principleDirection: Emit a structured signal (log line, typed return, tracking record) on every "nothing happened" code path so silent failures become queryable.
principleDimensionVector: {"evidence_density": 1.0, "governance_compliance": 0.6, "long_term_maintainability": 0.5, "human_cognitive_load": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleConsumerArchetype: ai-coworker-universal
principleRingScope:
  - universal-ring
principlePublic: false
authoredAt: 2026-05-24
authoredBy: mark-bodman
---

# Make silent failures observable

**A code path that does nothing must say so.** Whether the path
returned early because of an empty input, skipped a step because a
precondition wasn't met, or genuinely had no work to do, the fact that
nothing happened is itself a signal — and the signal has to leave a
record.

A silent no-op is invisible work. Invisible work cannot be debugged,
cannot be tracked, cannot be calibrated against, and erodes operator
trust the moment the operator notices the thing-that-should-have-happened
didn't happen.

## What "observable silent failure" looks like

- A function that returns `null` because a lookup found nothing emits
  `[surface.no-match]` log line with the lookup key, the call site, and a
  tracking BI reference if the no-match represents work to do later.
- A scheduled job that exits early because the queue was empty writes a
  heartbeat record so the operator can tell the difference between "job
  ran, queue was empty" and "job didn't run."
- A contribution flow that aborts because DCO wasn't signed returns a
  typed `{ outcome: 'aborted', reason: 'dco-missing', missingArtifacts: [...] }`
  instead of `{ success: true, prUrl: null }`.
- A seed step that skips a row because the FK target is missing emits
  `[seed.skip]` with the row identifier and the missing FK, not a silent
  pass.

## Why this exists

Three concrete examples from the platform's recent history:

- **Governed-upgrade `resolveTargetSha`** (PR #1076): when the resolver
  finds no target SHA, it now logs `self-upgrade.no-target` with a
  tracking BI. Earlier behavior was a silent `null` return — the
  self-upgrade loop simply did nothing, and the operator had no signal
  that anything had even tried.
- **Hive contribution silent-success** (memory
  `project_hive_contribution_gaps`, PR #137): the earlier
  `contribute_to_hive` returned `{ success: true, prUrl: null }` when
  the contribution actually failed on missing DCO / missing token / PR
  creation error. Three months of "contribution mode never works" traced
  to that single silent no-op return shape. The fix was structured
  failure outcomes — same surface, honest signal.
- **Reduction Gear `slipDetected` + `slipReason`** (PR #1075): every
  GearInterface record carries a `slipDetected` boolean and
  `slipReason` taxonomy (`novel-context`, `failed-outcome`,
  `human-override`, `cost-overrun`, `safety-block`, ...). Non-compounding
  work becomes queryable; the operator can sort by slip reason and see
  exactly why the gear train isn't transmitting torque.

The silent-failure alternative — let the code path return early without
emitting anything — produces three predictable failure modes:

1. **Cannot diagnose.** The operator sees an outcome (or the absence of
   one) and has no record of why. Diagnosis becomes archeology.
2. **Cannot calibrate.** Trust calibration and graduation logic depend
   on outcome attribution. A silent no-op contributes nothing to either —
   the gear train spins without registering torque or slip.
3. **Cannot prevent recurrence.** A silent failure that happens twice
   is indistinguishable from a silent failure that happens a hundred
   times. The pattern compounds invisibly.

## What "structured signal" means

Not every signal needs to be a log line at WARN severity. The
signal must:

- **Be discoverable.** A grep / log query / DB query lands on it
  reliably when an operator goes looking.
- **Carry the why.** Not just "function exited early" — the reason,
  with enough identifiers to find the source row / record / input.
- **Be cheap.** A `[surface.no-match]` log line at DEBUG is fine for
  high-frequency no-ops; the goal is observability, not noise.
- **Compose with the rest of the platform's evidence stream.**
  GearInterface records, ToolExecution rows, tool-trace lines all
  serve as structured signals.

## When silent return is acceptable

- **Inside a hot loop where the no-op is the dominant case** (e.g.
  iterating a sparse array; cache lookups on a miss-heavy surface).
  In those cases the *outer* surface emits the aggregate signal once
  per call boundary, not per inner iteration.
- **When the return type itself carries the signal** (e.g. a `Result<T>`
  type whose `None` variant is structurally distinguishable from `Some`
  by every consumer). The "signal" is the typed return, not a log line.

The bar: a future debugger looking at this no-op must be able to tell
*that it happened*, *why*, and *whether to care* — without re-running
the original execution.

## The contract

Before merging a code path that can return early without doing the work
the caller expected:

1. **Name the no-op.** What does it look like from the caller's side?
2. **Emit a signal.** Log line, typed return, or tracking record.
3. **Make the signal queryable.** Future-you needs to find these by grep
   or by DB query.
4. **Decide whether to track.** If the no-op represents future work,
   file a tracking BI in the same PR.

## Anti-patterns

- `if (!precondition) return;` with no log line and no typed return.
- `{ success: true, prUrl: null }` or other shapes that conflate success
  with no-op.
- `try { ... } catch { /* ignore */ }` — the swallowed exception is the
  failure that just went silent.
- Early-return at the top of a function with no record that the call
  even happened.

## Related principles

- [`fail-fast-explain-clearly`](fail-fast-explain-clearly.md) — paired
  discipline; this principle covers the no-op case (nothing went wrong,
  nothing happened, no record of why), `fail-fast` covers the error case
- [`evidence-before-diagnosis`](evidence-before-diagnosis.md) — depends
  on this; you can't query underlying state for diagnosis if the
  underlying state was never recorded
- [`check-tool-signals-first`](check-tool-signals-first.md) — the
  caller-side counterpart; the tool's return value is the signal the
  caller reads

## Spec references

- [Reduction Gear Architecture spec](../../../superpowers/specs/2026-05-24-reduction-gear-architecture-design.md) — §3.1 slipDetected / slipReason
- [Governed-upgrade plan](../../../superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md) — `self-upgrade.no-target` instrumentation
- [Founder kernel evolution discipline spec](../../../superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md) — §6.3 promotion record
