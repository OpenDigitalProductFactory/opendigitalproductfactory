---
status: active
---

# Small retained runtime acceptance repair

BI-80D1FBBF repairs the retained Small lane under the existing
[work-shape contract](2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md).
It does not implement BI-E3B918C2's independent acceptance campaign.

## Evidence and decision

BI-DB4E6F81 is declared/effective Small, low sensitivity. Its source was merged
as PR6438/5b4871e651f0 and deployed. Real runtime observations distinguish
not-dispatched routing refusal from unknown execution. Yet its retained sweep
unconditionally returns `retainedAcceptanceWithoutBinding`, which replaces the
Small delivery-coordinator lane with an independent acceptance-reviewer lane.
The native reader has no review packet for that invented requirement.

Published `gates-proportional-to-shape`, `shapeRequirements.small`, and the
backlog runbook assign Small acceptance to a runtime check. WWMD
DI-A16B129C9223 selected a bounded Small correction. Medium/large and
sensitivity-raised independence remain unchanged. This is founder platform
reliability work; refactor the shared binding validator rather than clone it
between evidence recording and consumption.

## Contract SMALL-RUNTIME-CONTRACT

**OBJ-SMALL-RUNTIME:** A delivered Small repair can finish its actual runtime
check without acquiring a larger shape's independent review contract.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-SMALL-RUNTIME | OBJ-SMALL-RUNTIME | Authenticated final runtime observations bind exact canonical closure, delivered source, successful deployment and served revision using server-owned facts. |
| AC-SMALL-FAIL-CLOSED | OBJ-SMALL-RUNTIME | Missing, forged, mismatched or stale proof never satisfies acceptance; missing Small checks retain the delivery-coordinator lane. |
| AC-SMALL-SCOPE | OBJ-SMALL-RUNTIME | Medium, large, unknown and sensitivity-raised work retain their existing independent acceptance boundary. |
| AC-SMALL-HISTORY | OBJ-SMALL-RUNTIME | New relevant failures supersede passes; duplicate writes preserve one result; historical unbound observations remain observations. |

## Flow SMALL-RUNTIME-FLOW

Extend the existing `record_runtime_verification` service, not a second writer.
For a final-acceptance observation explicitly attached to a canonical closure
activity and its Workroom, resolve the item and effective shape, authenticated
actor, exact delivered PR/head/merge, successful upgrade and actual served SHA.
Reserve one server-owned result namespace; reject caller injection. Require a
real bounded check interval within the current deployment generation, command
and observations. Preserve ordinary verification behavior for other callers.

Persist the binding with RuntimeVerification in the existing transaction.
Recheck closure identity, item status, Workroom identity and deployment generation
at commit; a swap or unknown proof refuses, never silently certifies another SHA.
Use the existing quiescence/transaction ordering and current authority checks.
One stable verification ID has one immutable result; a changed result needs a new
real check, never an overwrite. No new schema, grant or authority is introduced.

The retained sweep resolves exact closure-bound verification rows with strict
bounded history and uses the same binding parser. Match current authoritative
closure/source/deployment facts. A relevant failed check cannot be hidden by an
older pass. Unbound old records cannot be backfilled. Small missing/failure
projection preserves the delivery-coordinator runtime lane. Stronger shapes keep
the existing E3 unresolved independent-binding projection.

## Plan SMALL-RUNTIME-VERIFY

1. Reproduce the all-done Small escalation in the existing sweep suite.
2. Add the shared Small binding helper and writer/consumer integration; prove
   actor, source, shape, closure, generation, interval and namespace refusals.
3. Exercise real transaction rollback/concurrency and duplicate identity on the
   governed shared test runtime. Run affected suites, both TypeScript programs
   and the exact-tree integration gate, then independent source assessment and
   normal DCO/protected PR delivery.
4. On a containing canonical deployment, drive the original recovery behavior,
   record a fresh closure-bound runtime observation for BI-DB4E6F81, and verify
   its actual retained owed state clears. Deployment alone is never acceptance.

All steps are one atomic repair: a writer without its validating reader cannot
close the obligation, and a reader without an authentic writer would accept
forged evidence. No independent acceptance task, plan baseline, historical review
replay, clearance change or status reset is part of this repair. Original E3/7F
and provider-uncertain review histories remain untouched.

Migration: none. Compatibility: ordinary runtime observations and old unbound
records stay readable; only new qualifying Small checks gain this binding.
Rollback: restore the unresolved projection while retaining immutable evidence.

## Backlog coverage

Atomic BI-80D1FBBF; requirement OBJ-SMALL-RUNTIME; contract
SMALL-RUNTIME-CONTRACT; flow SMALL-RUNTIME-FLOW; verification
SMALL-RUNTIME-VERIFY. Native coverage receipt is recorded before implementation.
