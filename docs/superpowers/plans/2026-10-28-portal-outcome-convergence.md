---
status: draft
---

# Portal outcome convergence delivery plan

**Parent:** BI-81AB897A. **Workroom:** WC-6D8C9787.
**Status:** proposed decomposition; independent scope/plan approval and coverage receipt pending.

The operator's October 28 authorization covers governed delivery of this program.
This documentation commit authorizes no executable edit by itself. Each slice
uses that existing operator authorization and still needs current admission and
coverage; no new phase-change confirmation is required.

For agentic workers: execute this plan one independently reviewable backlog item
at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate
before any success claim, and `dpf-pr-with-dco` for handoff.

## Design grounding

The [canonical integration design](../specs/2026-10-28-portal-outcome-convergence-design.md)
extends existing page perception, authorized surfaces, Workroom orchestration,
background observation and canonical completion contracts. The
[assessment](../audits/2026-10-28-portal-outcome-assessment.md) and its
[route export](../audits/2026-10-28-portal-outcome-coverage.csv) separate source
coverage from exercised behavior. No new issue store, scheduler or orchestrator
is proposed. Existing Windows COO work keeps its ownership and review gates.

## Backlog coverage

Decision: **decomposed**. These deliverables are independently shippable. This
table is the proposed graph, not a governed coverage receipt. Record the receipt
against this immutable plan only after the parent's independent scope baseline
exists; copy its identity here and check current coverage before implementation.

| Key / live item | Requirement references | Contract references | Flow references | Verification references | Dependencies |
| --- | --- | --- | --- | --- | --- |
| facts / BI-7CE02DE9 | OBJ-FACTS, AC-FACTS | shared-client-projection | client-help | V-FACTS | none |
| continuity / BI-B7E2DD4B | OBJ-CONTINUITY, AC-CONTINUITY | durable-request-authority | accepted-turn-recovery | V-CONTINUITY | none for local adapter; COO follow-through integrates with BI-C43FD3E5 |
| build-truth / BI-69B29AEC | OBJ-TRUTH, AC-TRUTH | canonical-build-progress | artifact-to-release | V-BUILD | none for projection |
| freshness / BI-3EF5D3B2 | OBJ-TRUTH, OBJ-OWNERSHIP, AC-OWNERSHIP | background-observation | evidence-renewal-recovery | V-FRESHNESS | COO integration BI-C43FD3E5 |
| coo-recovery / BI-C43FD3E5 | OBJ-OWNERSHIP, AC-OWNERSHIP | coordinated-workrooms | owner-acknowledgement-result | V-COO | historical proof BI-7906C73E; preserve distinct semantic-review and hydration-fence lanes |
| coo-progress / BI-756C899D | OBJ-TRUTH, AC-TRUTH | effective-progress-clock | stall-to-owner | V-COO | existing Windows delivery plan |
| coo-front-door / BI-80ADD3A8 | OBJ-OWNERSHIP, AC-OWNERSHIP | coordinator-authority | correct-specialist-handoff | V-COO | recorded employee clearance-policy decision |
| perception-coverage / BI-0DFE48B4 | OBJ-COVERAGE, AC-COVERAGE | authorized-surface-contract | route-to-authorized-context | V-COVERAGE | facts pilot; expand by shared consumer |
| upgrade-journey / BI-705CA714 | OBJ-FACTS, AC-FACTS | progressive-update-projection | condition-to-supported-repair | V-CLIENT | existing update-page delivery scope |

Toolchain BI-63672FBE and reason-projection BI-3E66F76F are delivered
predecessors. Their next-release/unattended and loaded-session acceptance remains
explicit evidence debt, not a reason to duplicate their source changes. Shared
supervision BI-63FB1683 and umbrella BI-4B48E7FE are dependencies whose
awaiting-acceptance state is not proof of runtime success.

## Phase 1 — Admit the assessment and independent scope

Publish the assessment, source-derived coverage, integration design and this plan
as one documentation concern. Bind the Workroom to the full published head.
Record classification/research with actual immutable source evidence. Request
the server-issued independent design, spec-approval, architecture and plan
reviews in their declared order. Preserve failed findings and exact remedies.
Record the decomposed live coverage receipt once admission permits it.

The current exact-path impact contract is resolved: documentation has no test
or guard obligations; regenerate/check `doc-index` using
`node scripts/gen-doc-index.mjs` and `node scripts/gen-doc-index.mjs --check`.
Run the documentation pregate and protected PR health checks. A subsequent
executable scope requires a new impact contract and its tests/guards.

## Phase 2 — Share client facts (facts, independently shippable)

Claim BI-7CE02DE9 at its actual proportional shape. Reuse
`apps/web/lib/agent-toolchain/connected-clients.ts` as the fact authority,
`apps/web/lib/tak/self-upgrade-route-context.ts` as the existing adapter and
the authorized-surface registry as the canonical surface contract. Inspect
permission enforcement before choosing a loader. Do not add blanket grants.
Keep credential observations distinct from machine inventory and loaded state
distinct from installed/released state. Strip credential identifiers and secrets.

**V-FACTS:** regression tests for same projection, unknown/unavailable states,
count semantics and denied view; admitted runtime client-help question gets
current facts or explicit unavailability and supported next route. Functional
assistant verification is required; a unit test does not earn it.

## Phase 3 — Reconcile completion (build-truth, independently shippable)

Claim BI-69B29AEC. Inspect the canonical current task-attempt and release
projection before editing `apps/web/components/build/build-studio-operator-view.ts`
and `apps/web/lib/build/customer-status-projection.ts`. Preserve historical
conflicts and legitimately superseded attempts. No status rewrites or task replay.

**V-BUILD:** conflicting phase/task evidence, superseded attempts,
documentation-only completion, pending promotion and verified deployment.
Exercise the served historical example and a healthy fixture. Artifact complete,
released and verified running must remain distinct.

## Phase 4 — Durable accepted help (continuity, independently shippable)

Produce BI-B7E2DD4B's detailed design against the current accepted-message,
TaskRun/ScheduledAgentTask, deadline, current authority, budget, cancellation and
effect-receipt substrates before implementation. Inspect `/api/agent/send` and
its existing after-callback boundary. Persist executable intent, not just text.
Unknown effects require reconciliation; proven-not-started capacity waits may
continue under bounded policy. BI-F6AD1E18 remains the background-outage owner;
BI-F5D58F29 remains the external supervised-session owner.

**V-CONTINUITY:** admitted nonproduction restart before dispatch, in flight and
after uncertain response; navigation/reconnect, cancellation, expiry, revoked
authority and duplicate-effect prevention. No production fault injection.

## Phase 5 — Recovery ownership and evidence currency

For freshness, diagnose the original running scan through supported runtime
evidence and read the actual cited provider policies before renewal. Reuse
existing job lifecycle and compliance procedures. BI-DA37A602's age warning
and BI-68D44727's warning delivery are preserved history, not scan/evidence
completion. **V-FRESHNESS:** stale running, current complete, unavailable source,
failed worker and denied recovery with owner, next trigger and original locator.

For **V-COO**, consume the Windows owners' current merged/served evidence and
verify local owner, acknowledgement, next check, exact result and necessary
human decision on the existing shared supervision surface. Historical initiative
review AC3B3BF94A91 remains UNKNOWN/no replay until its accountable proof lane
settles it. Do not declare a review complete to unlock unrelated implementation.

## Phase 6 — Portal-wide coverage and regression

**V-COVERAGE:** reconcile every exported route to the existing inventories;
ratify purposes and add semantic context through BI-0DFE48B4 by actual job.
Exercise client help, blocked Workroom, expired provider, failed save, refused
approval, capacity wait, failed background work, interrupted executor and one
customer/finance journey. Contrast healthy/loading/stale/denied/waiting/failed/
recovered states, keyboard, mobile and relevant role/archetype fixtures. Mark
inapplicable with reason and unmeasured without an inferred pass.

**V-CLIENT:** supported connection, compatible declared loaded identity after
restart and next-release unattended convergence for each actually observed
supported client. Historic credentials remain history. Do not revoke, downgrade
or prune them merely to improve a count.

## Rollout, rollback and completion

Execution follows dependencies, not an unconditional date sequence. After
admission, facts and build-truth can ship while COO evidence remains blocked.
Continuity can complete detailed design and isolated nonproduction tests;
COO-dependent dispatch stays disabled until BI-C43FD3E5's existing gates pass.
Freshness may diagnose/present evidence under current read authority; unattended
cross-room recovery retains that same dependency. BI-80ADD3A8's employee
clearance decision must be recorded by its authorized policy owner before that
audience changes; other audiences retain current policy. There is no fallback
through wider grants or another COO. WC-6D8C9787 retains dependency/result
locators and rechecks them before dependent admission. Unknown review execution
remains held; a changed draft does not authorize replay of the original task.

Continuity first establishes whether existing carriers meet the intent contract.
If expansion is needed, review additive migration, tolerant readers/writers and
backfill before cutover; contract only after old writers/records are accounted
for. Rollback retains accepted identities, original deadlines and cancellation;
hold incompatible intent visibly and reconcile dispatched effects under their
original owner. Stand-down never extends expiry or discards accepted work.

Publish independently reviewed slices through protected DCO PRs. Run affected
tests/typechecks and the exact-path impact obligations; use the canonical
shared runtime for runtime-bound evidence. Advance the install only through
`request_self_upgrade`, then bind acceptance to served bytes. Revert an adapter
or stand down recovery dispatch through existing controls while retaining request
and evidence records; no destructive rollback or authority widening.

The parent remains open until AC-FACTS, AC-CONTINUITY, AC-OWNERSHIP,
AC-TRUTH, AC-COVERAGE and AC-REGRESSION have canonical evidence or an
explicit approved disposition. Capturing tickets, queueing reviews, merging
documents and observing arrival pages do not satisfy whole-journey acceptance.
