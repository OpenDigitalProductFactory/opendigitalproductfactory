---
status: active
backlog: BI-521A92CF
---

# Routine maintenance requests and budget reads

BI-521A92CF follows the merged BI-B22C8E02 operation-classification repair.
The operator authorized emergency DEV repair and cross-chat coordination.
Base: `9da4432dd433ef496c118cd82198af636d71b2c6`.

## Evidence and design grounding

On the named base, `routine-maintenance-request.test.ts` ran 23 tests:
4 failed and 19 passed. Two DEV request forms and the empty budget read retained
their static consequences; delegated escalation consequently stayed human.
Negative tests for production, unknown stance, malformed/override input, budget
mutations and absence of delegation passed. Existing handler admission tests
passed: the request always sends `actorKind: agent`, preserving batch admission,
maintenance windows, blackouts and human-override-required results.

Sources of truth remain `resolveCallConsequence`, the existing scoped OAuth
connection delegation, canonical `loadInstanceStance`, and the agent self-upgrade
admission pipeline. No new delegation, approval store or environment flag.
The budget handler writes only when parsed updates are present; its documented
empty-object form only reads current configuration and active build counts.

## Requirement R-routine and contract C-effect

| Call | Consequence | Execution boundary |
| --- | --- | --- |
| request_self_upgrade with no fields or string reason on canonical development/evolve-dpf | ordinary | Existing agent request pipeline; no immediate operator override |
| Other stance, unreadable stance, unknown keys or invalid reason | irreversible retained | Existing controlled path |
| set_backlog_delivery_budget with exactly no fields | ordinary | Existing read branch; no upsert |
| Any nonempty budget input | authority retained | Existing controlled path |
| repair_promoter_image | irreversible retained | No change |

Refinement alone grants nothing. Current connection delegation, grants, token
scope, restricted-data and propose boundaries still apply. Production receives
no upgrade refinement. The canonical stance is server resolved, never supplied
by a caller. No migration or UI control is added; existing consent disclosure
from BI-B22C8E02 already explains routine delegation and its remaining limits.

## Conditional cleanup findings

The nonproduction lease model stores caller-provided ownerSessionId and process
identity, but no authenticated user/agent owner. Its release transaction checks
the immutable gate session and updates under an environment lock; it has no
atomic unused-only guard. A classification-time snapshot cannot protect against
execution starting before release. No lease consequence is narrowed in this fix.
A subsequent repair must establish trusted creation ownership and check the
same no-execution predicate within the locked release transaction. Caller session
strings or audit guesses cannot substitute for that proof.

Frozen Workroom scope release is a separate ownership/CAS contract owned by its
current room; this branch does not edit or release those claims. CLI version
diagnostics are already provided by `get_build_engine_readiness({refresh:true})`,
verified on the live install without an approval envelope. Arbitrary compose
exec is not added to the diagnostic parser.

## Ordered flow F-delivery and verification V-regression

One atomic repair: the contract, both refiners and their regression evidence
ship together under BI-521A92CF. Neither the plan nor tests deliver behavior alone.

1. Reproduce classification and delegation failures on the named base (above).
2. Record immutable research and atomic plan coverage, then claim implementation.
3. Refine only the closed request/read forms using existing source authorities.
4. Run new regression tests, graph-linked and colocated pack tests, request
   admission tests, authorization tests, typecheck and the required guards/gate.
5. Obtain independent review, publish a signed PR, pass protected cloud checks,
   merge through the queue and coordinate canonical DEV delivery with its owner.
6. Verify actual MCP calls after the served source contains this fix; record
   deferred/batch/admission results as such, never as an executed upgrade.

Rollback reverts the two refiners and restores their static floors. Existing
consents and records remain valid. Source tests cannot prove live delivery.
