---
status: active
---

# Bounded autonomous blocker-descent — design

- **Backlog item:** BI-980FE9F5
- **Work capsule:** WC-A3C9ED46
- **Profile:** fix
- **Authored:** 2026-08-27

## Problem

A single external-agent task ran approximately 58 hours of billed capacity
across two days and 49 turns and did not deliver its named objective.
Individual turns ran 11h43m, 10h02m, 7h32m, 5h00m and 4h13m.

The task did nothing wrong by any rule then in force. It refused to
self-approve, refused to fabricate receipts, honoured every fail-closed gate,
merged ten PRs, and answered honestly each of the five times it was asked
whether it had delivered. It failed structurally: it descended a chain of
blocker-of-blocker repairs with no depth bound, no recurrence limit, and no
cost ceiling.

```
Pet Rescue delivery                      <- named objective
  -> BI-A45D744A     (WordPress replay)
    -> BI-FFBDDD96   (baseline/coverage receipts)
      -> BI-47ACE2C7 (reviewer bootstrap)
        -> BI-SIG-463E478D (reader pagination)
          -> BI-42CE2CE7   (resumable TaskRun)
```

Nothing below the first line is the named objective. The majority of the
capacity went into repairing gate machinery the objective merely traverses.

### Why no existing principle caught it

Two principles are adjacent and neither applies.

`autonomous-directives-are-blanket-approval` grants latitude for "the named
multi-step work" and explicitly lists `"until it works"` as a qualifying
directive. It bounds destructive operations, out-of-band scope expansion, and
external actions — but places no bound on how far the work being done may drift
from the work that was named. The operator said "continue until its objectives
are met". That authorised every line above.

`responsible-capacity-utilization` governs idle-versus-active and busywork:
"when no useful, safe, evidence-producing work is available, the coworker
records or surfaces the blocker rather than spending tokens to appear busy."
The agent was active, safe, and evidence-producing throughout. The principle
reads as satisfied while 58 hours produced no delivery.

The gap is precise: **the platform knows how to tell work from busywork, and
does not know how to tell the named work from work that is merely adjacent to
it.**

The task also could not detect its own recurrence. Three blocker classes
(pre-inference provider-busy consuming an immutable review identity, split
reviewer grants, capacity races) each failed three or more times and were
retried rather than escalated.

## Research

Full-repository sweep for an existing capability found nothing:
`blockerDepth`, `escalationBudget`, `maxBlockerDepth`, `prerequisiteDepth`,
`metaWorkDepth`, `blocker_chain`, `escalation_budget` — zero matches across
the tree. The principles corpus matched only the two pages named above.

Adjacent filed work covers different failure modes and must not be duplicated:

| Item | Covers | Why it is not this |
| --- | --- | --- |
| BI-7C1F43E3 | flow efficiency, request coalescing, WIP and progress SLOs | bounds *throughput and waste*, not *scope drift* |
| BI-114C1F40 | Workroom WIP, progress SLOs, durable-wait liveness | a stalled task, not a productively-wandering one |
| BI-MCP-EFF-0285909C | lease polling to durable wait and resume | transport, not authority |
| BI-42CE2CE7 | transient capacity consuming a TaskRun | one instance of the chain above |

The distinction that matters: every item above would have made the 58-hour run
*cheaper*. None would have made it *stop*.

### Prior art

Bounded recursion with mandatory escalation is the standard shape. Erlang/OTP
supervisors escalate to their own supervisor on `MaxRestarts` within a period
rather than restarting forever; circuit breakers trip open after a failure
threshold instead of retrying; incident practice escalates on the second
recurrence rather than the Nth. All three encode the same rule this design
adopts: repeated local failure is evidence about the system and belongs to a
higher authority, not to another local attempt. DPF adopts the depth bound and
the two-strike recurrence rule; it rejects a time-based or token-based ceiling,
which would penalise a long, hard, entirely on-objective run — the exact run
the directive was meant to buy.

## Decision

Bound the directive by **descent**, not by effort.

| Depth | What it is | Authorized |
| --- | --- | --- |
| 0 | the named objective | yes |
| 1 | a blocker of the named objective | yes |
| 2 | a blocker of that blocker | **no — stop and hand back** |

Plus two stop rules: the same blocker class failing twice is a stop, not a
third attempt; and a run that cannot name what it will deliver next and roughly
what it will cost has already left scope.

Operator re-consent at a bound re-arms the directive for the newly named work
only. It does not grant unbounded further descent.

Considered and rejected:

- **A time or token ceiling.** Penalises exactly the run the directive was
  bought for — long, hard, on-objective. Depth is the property that actually
  correlates with drift.
- **A new supervisor agent.** A parallel authority to police the first is more
  substrate, and it would need its own bound. The bound belongs in the
  directive itself.
- **Forbidding blocker repair entirely.** Depth 1 is genuinely the work; an
  agent that stops at the first obstacle is useless.
- **Raising the bound to depth 3.** The observed chain reached five. Any bound
  above 1 re-admits the case where the operator cannot recognise the work.

## Scope — this change

Doctrine only.

- `docs/founder-kernel/wiki/principles/autonomous-directives-are-blanket-approval.md`
  — the descent bound, the two stop rules, the worked counterexample, and the
  bound added to "what still requires approval". Abstract and
  `principleDirection` updated to carry it.
- `docs/founder-kernel/wiki/principles/responsible-capacity-utilization.md`
  — a "what this principle does NOT cover" section naming the gap and pointing
  at the bound, so the pair reads as two halves of one question.
- `AGENTS.md` §1 — the one-line operative rule with its kernel pointer.

`principleDimensionVector` is deliberately left unchanged. The numeric vector
feeds `principle_decide` scoring; perturbing it would silently re-weight
unrelated decisions, and the bound is a rule about scope rather than a new
magnitude on an existing axis.

## Deliberately not in this change

The BI's acceptance criteria also require depth and lineage to be **derivable
from live state** rather than from agent prose, and elapsed capacity per
objective to be queryable. That is a projection over `BacklogItem`,
`WorkCapsule`, `TaskRun` and `WorkCapsuleActivity` and is a separate slice
against the same BI.

Shipping doctrine first is not a shortcut. The observed failure was an agent
faithfully following a rule that did not exist yet; the rule is the load-bearing
half, and it is enforceable by review and by the agent contract the moment it
lands. The projection makes it *measurable* and removes reliance on self-report.
BI-980FE9F5 stays open until both land.

## Verification

- Doc reference integrity and the spec/plan status convention pass.
- The claim under test is a rule, not a code path: the check is that an agent
  reading `AGENTS.md` §1 and the kernel page reaches "stop and hand back" on
  the counterexample chain. The counterexample is stated in the page with the
  real BI identities so it is checkable against live backlog state.

## Risk

Low, and asymmetric. The failure mode of an over-tight bound is an extra
operator round-trip; the failure mode of no bound is two days of capacity for
no delivery, already observed once. No gate is weakened, no evidence
requirement relaxed, nothing becomes fail-open.

The one real risk is over-application: an agent reading the bound as licence to
stop at the first difficulty. The page addresses it directly — "the bound is on
descent, not on effort" — and depth 1 remains explicitly authorized.

## Implementation sequence

Single phase, single commit, no separate plan document: one deliverable mapping
1:1 to BI-980FE9F5 with nothing deferred beyond the slice named above, which is
already recorded on the BI.

1. Extend the kernel principle with the bound, the stop rules and the
   counterexample; update abstract, direction and related links.
2. Add the reciprocal "does NOT cover" section to
   `responsible-capacity-utilization`.
3. Add the operative one-liner to `AGENTS.md` §1.

## Rollback

Single revert. Reverting restores unbounded descent, which is what ships today.
