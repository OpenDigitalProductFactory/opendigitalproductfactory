---
title: Report only the verdict you reached
slug: report-only-the-verdict-you-reached
pageKind: principle
status: published
abstract: A check that could not conclude must say so, not emit a conclusion. Crashing, losing its transport, or reading stale state are all "I don't know" — reporting them as "I found a problem" is a plausible wrong answer, and a check that returns those gets switched off before the day it matters.
principleTier: core
principleDirection: Separate "I found a problem" from "I could not tell", and emit the second as its own outcome rather than collapsing it into the first.
principleDimensionVector: {"evidence_density": 1.0, "human_cognitive_load": -0.2, "long_term_maintainability": 0.6, "governance_compliance": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principleRingScope:
  - universal-ring
principlePublic: false
authoredAt: 2026-08-28
authoredBy: mark-bodman
---

# Report only the verdict you reached

**A check that could not conclude must say so, not emit a conclusion.**

Every check has at least three outcomes, not two: *pass*, *fail*, and **I could
not tell**. The third is the one implementations forget. When it is missing, the
inconclusive case gets folded into one of the other two — and the check starts
producing confident answers it never actually computed.

This is the dual of [[make-silent-failures-observable]]. That principle says
silence must speak. This one says the noise must not lie.

## Why this exists

A wrong verdict is worse than no verdict, because a verdict gets acted on.

Four instances, all measured on this platform within one working session:

- A guard **crashed** on an unguarded `statSync`. The runner reported
  `1/37 guard(s) FAILED (found violations)` — with no violation block printed,
  because there were none. The crash was rendered as a finding.
- A gate waiting on a dead executor treated **"I cannot reach the control
  plane"** as ordinary waiting, and polled a corpse for thirty minutes on a
  one-slot pool, blocking every other session on the host.
- A reconciliation check compared a distinct-node count against a summed row
  count and reported **drift on perfectly healthy data**.
- A typecheck run against a stale generated client reported **121 errors in
  files nobody had touched**, in a form that read as ordinary type breakage.

None of these errored. Each produced a plausible wrong answer, and each cost
real time to a reader who had no way to tell it from a real one.

## What to do

**Give "I could not tell" its own outcome.** A tri-state (`true` / `false` /
`null`), a distinct exit code, a separate log verb — whatever the surface
allows. If a caller cannot distinguish "no problem found" from "the check did
not run", the check is not finished.

**Make the inconclusive branch fail in the safe direction, and say which
direction that is.** Safe is not always "stop": for a liveness probe, an
unreachable control plane must NOT read as *dead*, because unreachability is
precisely what kills the thing being probed — so unknown keeps waiting. For a
policy gate, unknown blocks. The direction differs; stating it explicitly is
what does not.

**Never let a crash surface as a finding.** A non-zero exit with no finding
printed is a crash. Runners must distinguish the two, and a runner that cannot
should report the ambiguity rather than pick.

**Do not report a verdict about state you did not read.** A record from a
previous run is evidence about that run, not this one.

## The consequence clause

A check that reports verdicts it did not reach **gets disabled** — by a switch,
or by people learning to ignore it. Either way it is gone before the day it
would have mattered. This is why a permanently-red check is worse than no
check at all: it trains its audience out of the habit the check exists to
create.

That failure mode is why enforcement is sequenced last. A guard shipped before
its signal is trustworthy will sit red against genuinely healthy data, and be
switched off long before it could catch anything.

## Related

- [[make-silent-failures-observable]] — the dual: a path that does nothing must
  still emit a signal.
- [[evidence-before-diagnosis]] — the caller-side obligation: verify a suggested
  cause against the underlying state before naming it. A check that honours this
  principle is what makes that verification cheap.
- [[remove-avoidable-failure-opportunities]] — better than reporting the
  ambiguity is designing a check whose inconclusive state cannot arise.
