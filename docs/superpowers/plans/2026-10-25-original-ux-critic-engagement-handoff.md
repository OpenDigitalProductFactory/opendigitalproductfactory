---
status: active
---
# Original UX Critic engagement handoff implementation plan

Backlog: BI-BCBCA8D1. Workroom: WC-6CCF8DAB.
Design: docs/superpowers/specs/2026-10-25-original-ux-critic-engagement-handoff-design.md.

## Scope and acceptance

This is one atomic correction to the existing engagement execution contract,
separated by the existing E27 owner's acknowledged handoff. Reuse its partial
code with provenance; do not copy its unrelated framework or replay E85C.
No phase is independently shippable because dispatch without attributable result
persistence reproduces the defect and result projection without safe dispatch
cannot prove execution. Admission/coverage must be current before source edits.

Original BI acceptance, verbatim:
- An authorized low-risk service engagement can execute through a governed catalog lifecycle and return attributable findings and artifact references.
- Advisory design critique remains distinct from formal initiative gate receipts; refusal returns a usable supported remedy when needed.
- Status requested, running, completed and failed reflect execution and never equate request creation with completed review.

Contract references: original-engagement-execution; immutable-revision-association;
server-owned-read-provenance; original-workroom-result-return.
Flow references: request-authorize-dispatch-execute-persist-return;
lost-response-observe-same-task; unknown-effects-no-replay.
Verification references: engagement-regression-suite; governed-integration-checks;
original-ce-live-critic-result; attributable-routing-author-disposition.
Requirement references: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7.

## Sequence

1. Record the live trace and decision for code rather than generic configuration.
Reconcile existing ownership and exact scope claims. Resolve impact advice for
all claimed paths before Red. Use existing BI and immutable plan provenance for
the live coverage receipt. Keep failed/unrun gates explicit.
2. Write failing behavioral regressions against existing partial contract:
metrics-only audit, incomplete source, free-text f52 substitution, concurrent
reservation, changed authority, unknown effects and duplicate Workroom return.
Expected touched tests: engagement-fulfillment.test.ts,
engagement-task-contract.test.ts, engagements.test.ts,
external-coworker-task-adapter.test.ts and coworker-service-catalog-pack.test.ts;
add engagement-read-provenance.test.ts for shared compact read evidence.
3. Refactor existing partial fulfillment into pure binding, source-provenance,
result validation and transactional lifecycle helpers. Integrate through existing
task submit/worker/authority boundaries after normal shared-file claim handoffs.
Preserve original CEs and exact immutable scope; add explicit revision association.
4. Add actionable failure/read states and idempotent result return using existing
Workroom activity/projection and engagement metadata. Update contributor/user
workflow docs and generated artifacts identified by the impact contract.
5. Run affected tests and package typechecks. The current impact contract requires
style-drift-guard and doc-index/capability-completeness derived checks. Resolve
additional shared-file impact obligations before editing those paths. Run exact
canonical integration and required checks; publish a ready signed PR and use the
protected merge queue. No test result is implied by this plan.
6. Request canonical self-upgrade, verify served source, and fulfill original
CE-724328D6 with its f52 artifact through the supported tool. Reconcile CE-1FE20783
within its original research/no-runtime-mutation boundary. Associate any newer
review explicitly. Read actual task/engagement result, provenance and Workroom
return; send genuine result to original routing chat for author disposition.

## Backlog coverage

One atomic deliverable: original-engagement-handoff, BI-BCBCA8D1; dependsOn=[].
Coverage receipt: cmvo23l846g8i01muim8ioqrg at immutable plan f93da777d5795fcf8fe75da20c60cb8f55b69fe4; research initiative-ed514e78-0428-45af-84d8-80ec7ca3b9c8; implementation admitted IRD-8699D18EC453. Refresh coverage after source/scope changes.

## Risks and rollback

Authority validation, durable task admission and result provenance are the main
risks. Missing provider read authority or room admission is an actionable refusal,
never permission to self-grant or share source using the requester's identity.
Source-only checks remain structural; acceptance requires actual Critic execution.
Rollback retains historical bindings/effects and disables new admission; unknown
outcomes remain fenced and unreplayed. Review and deployment proof are separate.


## Live continuation correction (2026-10-25)

The canonical .133 runtime admitted CE-724328D6 once, then its original task
failed in immutable request reconstruction before execution reservation. The
JSONB round trip reordered nested binding keys used by the v2 JSON.stringify
digest. Preserve the original digest by normalizing only engagement bindings
into the original admission order, including nested locators. Do not change
non-engagement packet hashing. Verify actual PostgreSQL readback and unchanged
original packet. Load reconciliation dependencies before its transaction and
retain atomic completion plus Workroom return; phase timings locate any remaining
latency. Observation errors must identify projection failure without dispatch.

An explicit identical fulfillment may reserve one continuation of this exact
known pre-admission failure on the same TaskRun. Require the worker's exact
reconstruction error, original digest/CE/prompt/scope, unclaimed dispatch 1,
no heartbeat, no effects/inference/messages/fences and no prior continuation.
Revalidate current caller and original authority with the existing same OAuth
family continuity contract; retain the origin identity and digest. Keep the
entire failed progress snapshot in a versioned continuation record, CAS the
original failed row, and persist a fresh deterministic dispatch event 2. Never
resume an unknown or started execution. Observer calls never reserve work.
This adds no service, authority grant, table, replacement CE or new TaskRun.
