---
status: active
---
# Exhausted plan-review routing

Backlog: BI-CAP-EF2B04BB. Workroom: WC-852E8178.
Existing design: docs/superpowers/specs/2026-08-25-immutable-source-review-traversal-design.md.
Existing writer recovery: apps/web/lib/mcp-task-terminal-writer-escalation.ts.

## Acceptance contract

- A valid covered-plan request on an unchanged child branch dispatches to the independent reviewer.
- Stale plan, baseline, room head, forged packet, missing grants or non-independent writer remain refused.
- Existing design/spec/PIR and acceptance routes retain their original immutable artifact contracts.
- Tests reproduce the issuer-versus-authorizer failure before source repair; shared runtime proves original request can be admitted after canonical upgrade.


## Acceptance continuation: exhausted plan reviewer (2026-10-12)

The original exact-bound review reached terminal-writer-retry-exhausted at attempt 3 after canonical reader recovery. The current issuer still selects AGT-WS-REVIEW, although change-reviewer holds the same current writer and reader grants. Continue this case atomically; do not replay the exhausted task, reset attempts or invent a caller request key.

Acceptance
- For the same user and current OAuth task authority family, an exact plan-review packet with recorded terminal writer retry exhaustion selects the next currently eligible independent writer and reader grant holder using the existing target-bound plan request key.
- Other users, authority families, packet identities, active tasks, approval waits, writer refusals and uncertain provider settlement do not exclude a reviewer.
- The claim issuer and request authorizer regenerate the same alternate packet; stale or forged packets and missing current authority remain refused.
- With every eligible reviewer exhausted, recovery returns an actionable bounded refusal without dispatch, retry reset, synthetic receipt or grant change.


## Design grounding

Extend the existing deterministic reviewer issuer and OAuth task authority namespace.
Plan packets already hash their target, binding and objective. Reuse that key,
the persisted request digest validator and terminal-writer exhaustion parser.
The immutable plan, workroom, baseline and reader/writer requirements are unchanged.
Scope this repair to plan-review; general provider settlement and pre-baseline
review succession are separate work. No schema, grant or UI change.

## Ordered atomic phases

1. Reproduce the exact terminal-exhausted first candidate still being issued;
   add scoped task-history tests for user, authority family, request digest,
   binding and current input-required exhaustion. Writer rejection, capacity,
   human approval, active work, unknown provider outcome and completed review
   must not make a reviewer ineligible.
2. Prepare candidate packets through the existing issuer before selection.
   Supply a server-owned exhaustion predicate only for plan-review. Skip exact
   exhausted candidates and use the next active production independent holder
   of both writer and reader grants. Exhaustion of all holders returns the
   existing no-eligible-reviewer escalation, with the exhaustion reason.
3. Carry server-resolved task authority through claim attribution and the
   independent request authorizer. Both paths use the same persisted-history
   validator; callers cannot submit exclusions. Completed review replays retain
   their existing receipt path.
4. Verify all affected and graph-linked tests, both web TypeScript programs,
   style drift, module limits, application DAG, generated doc index and diagram
   guards. Run host preflight and exact-tree shared pregate before DCO push/PR.
   Obtain one independent source assessment, protected checks and merge.
   Root coordinator owns canonical publication and live original-case acceptance.

All phases constitute one atomic deliverable: selection without shared
authorization would issue an unusable packet; authorization without selection
would retain the deadlock. No independent new work is introduced.

## Impact contract

Resolved scope contract 2026-10-12: required design grounding; source module limits;
style-drift guard; doc index and diagrams; graph-linked tests resolved before Red.
Include terminal-recovery, independent-review-request, issuer/baseline/lane/
research-order/revision-binding, acceptance sweep, approval-convergence-inventory,
governed claim/ownership/small-fix, handler actor, adoption/reassignment/intent/lease
and build entry suites. New history adapter needs colocated negative tests.
No graph links for the not-yet-existing adapter does not exempt it from tests.

## Traceability

Requirement: AC-DE-003 and BI-CAP-EF2B04BB acceptance above.
Contract: apps/web/lib/mcp-task-capacity-contract.ts.
Flow: apps/web/lib/tak/initiative-readiness-tool-grants.ts.
Verification: apps/web/lib/tak/initiative-readiness-tool-grants.test.ts.

## Risks and rollback

Incorrect history matching could globally exclude a reviewer or bypass approval.
Exact deterministic task ID, user, family, recorded request digest, immutable
binding, status and terminal escalation validation prevent that. DB failures
propagate rather than converting into permission. Revert the atomic source
change through a protected PR; audit rows and existing tasks are never mutated.

## Backlog coverage

Coverage pending immutable plan publication and the governed coverage write.
No source implementation begins before that receipt.

