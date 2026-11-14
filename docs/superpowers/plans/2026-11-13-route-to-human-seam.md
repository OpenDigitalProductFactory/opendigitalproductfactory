---
status: draft
---

# One routeToHuman seam: implementation plan

**Backlog:** BI-5E067004 (keystone of EP-8717D32C; atomic). **Workroom:** WC-6F29F1D4.
**Design:** [`docs/superpowers/specs/2026-11-13-route-to-human-seam-design.md`](../specs/2026-11-13-route-to-human-seam-design.md).
**Builds on:** BI-6B3DA9DD (`escalation-gate.ts`, `resolveDecisionEscalation`), and the issue-report stream classifier (`issue-report-stream.ts`).
**Decisions:** DI-82749A6FBEA1 (WWMD: reuse the issue-report projection for the non-owner route rather than a new queue, high confidence); DI-007A5617C3EE (WWMD on the PIR-QGQUH fixture features: `route-to-agent`, high confidence, margin 6.18, autonomy-eligible).
**Coverage decision:** atomic. The seam, the producers and the guard ship as one change. A seam without the guard is prose. A guard without every producer moved fails its own repo.

## Evidence

In the 14 days to 2026-11-13 the live install filed 91 owner escalations (`type = build-stall-escalation` or `selfFixClass` set). By trigger: 58 `build-pr-delivery-reconcile`, 28 `review-review-exhausted`, 5 `ideate-review-exhausted`. None passed the escalation gate. Most named mechanical blockers: a failing repo guard, a merge conflict, a stale base or an empty diff. PIR-QGQUH is one of them. Its only blocker was `Guard still failing after 2 repair attempt(s): Prose Lint Guard`.

The gate existed (`resolveDecisionEscalation`) but only the coworker MCP path ran it. The old escalation responder called `principle_decide` with no feature vectors and got all-zero scores, so it was deleted (header of `escalation-hygiene-runner.ts`).

## Producer inventory (origin/main c32a3a377ef3)

| Producer | File | Today |
|---|---|---|
| `escalateBuildToHuman` (7 call sites: gauntlet repair, ideate, independent design review, plan, PR CI follow-up, ship refusal, review verification) | `lib/build/escalate-build-to-human.ts` | report with `needs-human`, notify, abandon build, defer item |
| PR delivery stop | `lib/queue/functions/build-pr-delivery-reconcile.ts` | `build-stall-escalation` report with `needs-human` |
| PR delivery undecided merge state | same | `build-stall-escalation` report |
| PR follow-through attention | `lib/build/pr-follow-through-announce.ts` via the reconcile function | `build-stall-escalation` report with `needs-human` |
| Assurance remediation merge gate | `lib/assurance/remediation-merge-live.ts` | `build-stall-escalation` report with `needs-human` |
| Index integrity sweep | `lib/queue/functions/index-integrity-sweep.ts` | critical report with `needs-human` |

`status: "escalated"` in the PR delivery state machine is a delivery stop, not a hand-off. The owner learns of it only through the report above, so the guard covers the report, not the state literal. `route-work-item.ts` writes `escalated` on a different table (work-item routing) and is out of scope.

## Phase 1: the seam (`apps/web/lib/govern/authority/route-to-human.ts`)

- `classifyOwnerAttentionBlocker(facts)`: a pure, fixed mapping from the blocking facts to a blocker class (guard failure, merge conflict, stale base, empty change, review finding, unmitigated risk, check failure, infrastructure, observation budget, evidence withheld, other).
- `featuresForBlocker(class)`: a fixed feature table for the three options `resume`, `route-to-agent` and `escalate`. Each option uses the same 10-axis vector, so the consult is never featureless. This is the fix for the deleted responder.
- `decideOwnerAttentionRoute(input, consult)`: damage first. A critical risk tier, a declared consequence, a crossed threshold, a regulation, restricted data or a propose boundary reaches a person. The consult is skipped. Otherwise the seam consults the owning scope (WWMD for platform work, WWWD for organization work) and maps the result to a decision basis:
  - a decisive `resume` or `route-to-agent` result → `decided`;
  - a decisive `escalate` result → `policy-limit`;
  - no decisive result → `corpus-gap`;
  - a fault → `evaluation-fault`.
  It then calls `resolveDecisionEscalation`. The result is `agent`, `independent-review` or `human`, with a reason sentence.
- `routeToHuman(input)`: decides, then writes. The human route files the owner-attention report (`selfFixClass: needs-human`, reason in the description) and notifies the owner. The other two routes file an ordinary report, `type: routed-repair` with no `selfFixClass`. Issue-report triage projects it into an agent-pullable backlog item. It never reaches the Needs-you inbox.
- Tighten-only: the change only removes owner escalations. Every damaging case reaches a person as before.

## Phase 2: producers onto the seam

- `escalateBuildToHuman` asks the seam first. On the human route it behaves as today: report, notify, abandon, park. On another route it neither abandons the build nor parks the item (absorbs BI-B6894001 for these routes). It records the route on the build trail.
- The PR delivery reconciler, follow-through announce, assurance merge gate and index sweep call `routeToHuman` with their facts and declarations:
  - a closed PR declares `authority`: a person closed it;
  - a minor or major dependency bump or an unclassified change declares `thresholdExceeded`, the WWMD patch-only ceiling;
  - an index integrity drift is critical risk;
  - a staged-for-a-person repair is a propose boundary.
- Callers stop passing `SELF_FIX_CLASS.NEEDS_HUMAN`. The class is the seam's output.

## Phase 3: the guard (`scripts/check-no-unrouted-owner-escalation.mjs`)

It joins the `check-no-*` repo guard loop. Outside the seam, the report writer and tests, it fails on:
- `selfFixClass: "needs-human"`, or any `SELF_FIX_CLASS.` member, as a value;
- a `build-stall-escalation` type in a file that also calls `createPlatformIssueReport(`;
- `notifyAttentionLive` with `source: "escalation"`.

## Verification

- `route-to-human.test.ts`:
  - PIR-QGQUH (Prose Lint Guard) routes to an agent;
  - a merge conflict, an empty change and a stale base route away from the owner;
  - every damaging declaration routes to a person, unchanged, and the consult is not called;
  - every owner route carries a reason;
  - the feature table is non-empty and fixed for every class;
  - a consult fault and an indecisive consult route to independent review, never to a person.
- `escalate-build-to-human.test.ts`: the agent route does not abandon, notify or park.
- `check-no-unrouted-owner-escalation.test.mjs`: the guard catches each pattern and passes on the repo.
- The affected unit tests and the `apps/web` typecheck.
- Live: the PIR-QGQUH feature vector, scored by `principle_decide` (DI-007A5617C3EE), recommends `route-to-agent` with high confidence.

## Traceability

| Deliverable | Objectives | Acceptance | Contract | Flows | Verification |
|---|---|---|---|---|---|
| route-to-human-seam | OBJ-1, OBJ-2, OBJ-3 | AC-1, AC-2, AC-3, AC-4 | `apps/web/lib/govern/authority/route-to-human.ts`, `apps/web/lib/govern/authority/escalation-gate.ts` | escalateBuildToHuman, build-pr-delivery-reconcile, pr-follow-through-announce, remediation-merge-live, index-integrity-sweep | `apps/web/lib/govern/authority/route-to-human.test.ts`, `apps/web/lib/build/escalate-build-to-human.test.ts`, `scripts/check-no-unrouted-owner-escalation.test.mjs` |

- AC-1 (OBJ-1, OBJ-3): the guard test, including its whole-repository scan.
- AC-2 (OBJ-1): the seam tests on PIR-QGQUH, merge conflict, stale base and empty change; the build-escalation test of the agent route.
- AC-3 (OBJ-1): the seam tests on every damaging declaration; the existing build-escalation tests of the human route, unchanged.
- AC-4 (OBJ-2): the seam tests that every owner report carries its reason.
