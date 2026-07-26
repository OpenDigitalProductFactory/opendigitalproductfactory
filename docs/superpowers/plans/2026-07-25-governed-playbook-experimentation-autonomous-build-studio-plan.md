# Governed Playbook Experimentation and Autonomous Build Studio Implementation Plan

- **Status:** operator-reviewed and approved for implementation
- **Approved:** 2026-07-25
- **Date:** 2026-07-25
- **Approved design:** [`../specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md`](../specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md)
- **Backlog item:** `BI-0A636528`
- **Umbrella backlog item:** `BI-0A636528`
- **Delivery backlog items:** `BI-0A636528`, `BI-522E754E`, `BI-356E69B1`
- **Existing merge-recovery prerequisite:** `BI-7C4FDBF5`
- **Epic anchors:** `EP-COMPETENCE-FLYWHEEL`, `EP-BUILD-STUDIO`
- **Planning Work Capsule:** `WC-D8AC8735`
- **WWMD delivery-boundary decision:** `DI-99D1FF0C0E82`
- **Backlog coverage receipt:** `cms18ltgb05ry01p8eonh32jh`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Approval record

The operator explicitly approved this plan on 2026-07-25 after the architecture-review additions
and TaskRun lifecycle correction were incorporated. Implementation may now proceed one delivery BI,
branch, and PR at a time. Autonomous flags and live `AuthorityBinding` records remain rollout
actions governed by the slice gates below, not implementation shortcuts.

After approval, revalidate the backlog coverage receipt and re-sweep `origin/main`, open PRs, and
the live backlog before each delivery branch starts. If the approved design, an owning BI, or a
preserved substrate changed, update and re-review the plan before implementation.

## Goal

Deliver the approved Governed Playbook Experimentation Loop and make Build Studio fully autonomous
inside eligible, evidence-cleared lanes:

```text
governed backlog intake
  -> ideate
  -> plan
  -> build
  -> review
  -> ready PR
  -> GitHub merge queue
  -> governed self-upgrade/release
  -> deployed completion
```

The autonomous lane may research, select an active playbook, route to a healthy capable provider,
retry within a versioned recovery budget, repair verified defects, decompose once, reconcile remote
delivery state, and continue without routine human clicks. It must stop safely and create one
evidence-backed escalation when sensitivity, regulation, missing evidence, ambiguous remote state,
or exhausted recovery crosses the applicable authority ceiling.

## Definition of done

The program is done only when all of the following are true:

1. Every experiment cell identifies the resolved model/provider and exact method, tool, context,
   recovery, corpus, oracle, install, environment, and source versions that produced its outcome.
2. A deterministic model x method experiment can resume without duplicate cells, observations, PRs,
   queue entries, releases, or deployed-completion writes.
3. Promotion is multi-dimensional, policy-versioned, evidence-fresh, and mechanically capped to the
   activity/risk/model/corpus/install scope actually proved.
4. Exactly one active work-pattern `AuthorityBinding` exists per activation scope; supersession and
   rollback preserve prior evidence and the previous safe version.
5. An eligible low-risk Build Studio fixture completes end to end without a routine human click.
6. A high-risk/regulatory fixture, an exhausted-recovery fixture, and an ambiguous remote-state
   fixture all park safely and escalate before an unauthorized transition.
7. Existing build, security, review, UX, migration, PR-health, merge-queue, and self-upgrade gates
   remain intact and cannot be bypassed by the new lane.
8. Operator UI explains what is happening, why it is safe, and what genuinely needs attention
   without exposing raw experiment identifiers or animating stale work as active.
9. User, operations, architecture, and predecessor design documentation describe the shipped
   behavior without duplicating its source-of-truth rules.

## Grounding and current substrate

The following findings were verified against the current worktree, `origin/main`, and live
PostgreSQL backlog state while writing this plan.

| Concern | Current authoritative substrate | Planning consequence |
| --- | --- | --- |
| Build lifecycle | `FeatureBuild` in `packages/db/prisma/schema.prisma`; build orchestration under `apps/web/lib/integrate/` and `apps/web/lib/queue/functions/` | Extend existing phase transitions; do not create an experiment build lifecycle. |
| Durable execution identity | `TaskRun`, including `buildId`, `parentTaskRunId`, `a2aMetadata`, `repeatedPatternKey`, status, heartbeat, and indexes | Parent `TaskRun` owns the experiment manifest; deterministic child `TaskRun` rows own cells/attempts. |
| Phase attribution | `BuildPhaseRun` records build, phase, provider, tokens, duration, and cost | Add one nullable compact execution-profile reference; do not change phase cardinality or make it a trial table. |
| Experiment observation | `DecisionShadowLedger` already carries stable `ledgerId`, task/tool/decision links, regulatory evidence, metadata, outcome, agreement, and time indexes | Write immutable experiment assignments/outcomes here using a new source kind and typed metadata. |
| Active authority | `AuthorityBinding`, `AuthorityBindingSubject`, and `AuthorityBindingGrant`; editor validation prevents grant widening | Use `resourceType="work-pattern"` and a scope-locked transaction; do not create a playbook activation table. |
| Living Playbooks | `apps/web/lib/tak/work-pattern-types.ts`, `work-pattern-read-model.ts`, `work-pattern-shadow-evaluation.ts`, `work-pattern-review.ts`, and the existing AI Workforce panel | Preserve public statuses and candidate/Work Case review; add experiment and activation projections. |
| Work Case | Existing staging, receipt, decision, and resolution modules under `apps/web/lib/tak/work-pattern-case-*` | Escalations and case-bound proposals reuse the Work Case rail; no second approval queue. |
| Regulatory ceiling | `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts` and graduated autonomy modules | Promotion and phase eligibility must consume the resolved ceiling and fail closed. |
| Build gates | `auto-accept.ts`, `one-shot-lane.ts`, `graduated-autonomy.ts`, build review verification, scoped verification, and phase gate functions | Eligibility reads these results; it never replaces them. |
| Governed intake | `apps/web/lib/governed-backlog-tee-up.ts`, `promote_to_build_studio`, and `ideate-on-approval.ts` | Add eligibility decisions at existing intake/start seams, not a second scheduler. |
| Durable scheduler | Existing Inngest functions under `apps/web/lib/queue/functions/` | Experiment and reconciliation work runs as new functions on the existing scheduler. |
| PR and queue | GitHub merge queue is already enabled; `getPRStatus`/`mergePR` exist in `github-api-commit.ts`; generic auto-merge actuation precedent exists in `assurance/remediation-merge-live.ts`; `BI-7C4FDBF5` owns Build Studio merge recovery | Consume the common merge-queue/recovery contract delivered by the prerequisite; do not build another queue. |
| Governed release | `ship-on-review-approval.ts`, `build-flow-state.ts`, `reconcileDeployedShipBuilds`, self-upgrade queue functions, and deployed-SHA reconciliation | Continue through the governed runner and mark complete only when merged bytes are live. |
| Install scope vocabulary | `CAPABILITY_INSTALL_SCOPES` in `packages/db/src/capability-maturity.ts` | Reuse it exactly; do not add a dogfood enum. |

### Live backlog findings

- `BI-0A636528`, `BI-522E754E`, and `BI-356E69B1` exist, are platform-scoped feature
  items in `triaging`, have no active build, and retain the intended epic links.
- `BI-A834EE61` already owns the broader decision-outcome learning loop. This plan writes compatible
  `DecisionShadowLedger` evidence and does not duplicate its learning-policy responsibility.
- `BI-7C4FDBF5` already owns Build Studio stale-branch, merge-conflict, merge-queue, and operator
  recovery. Slice 3 is blocked on its reusable contract rather than copying that work.
- `BI-42AED141` confirms the repository merge queue is already live; its remaining queue-only heavy
  CI/general auto-merge work is not part of this plan.
- `BI-744D583B` owns profession-corpus injection into autonomous execution. This plan stamps the
  selected context policy and consumes the executor context it receives; it does not duplicate
  corpus injection.

### Substrate verdict

Extend the existing substrate. Do not add an experiment table, trial table, second scheduler,
second audit ledger, second authority model, new Work Case rail, new build lifecycle, or new public
work-pattern status enum.

One additive schema change is required: `BuildPhaseRun` has no metadata field in which to store the
approved design's compact execution-profile reference. Add a nullable `executionProfileRef Json?`
field. Existing rows remain valid and require no backfill.

`TaskRun(buildId,status)` is not currently indexed. Do not add that index speculatively. Measure the
Slice 1 parent/child and build/status query plans on representative volume. Add the additive index
only if the recorded plan shows it is needed.

## Architecture invariants

Every delivery must preserve these rules:

1. `FeatureBuild` is the one build lifecycle authority. Experiment cells may reference a build but
   cannot advance or fork its phase state.
2. `TaskRun` is the execution identity. Parent/child relationships and deterministic IDs provide
   experiment resume and retry identity.
3. `BuildPhaseRun` remains one row per build/phase under its existing unique constraint. It records
   the compact profile used by the actual build phase, not every experiment cell.
4. `DecisionShadowLedger` is append-only experiment evidence. Corrections add superseding rows;
   no prior evidence row is edited into a different truth.
5. `AuthorityBinding` is the only active-version authority. Capability-need JSON and read models
   are projections, never activation.
6. Work Case owns human-required exception handling, staged decisions, receipts, and consequence.
7. Governance evaluates evidence, not whether Build Studio, an external worker, or a replay
   produced it.
8. The GitHub merge queue remains the merge authority. No admin bypass, direct merge, force-push
   while queued, or private replacement queue is allowed.
9. Governed self-upgrade remains the live-install deployment path. No autonomous build may run
   direct Compose rebuilds or mark itself complete from a version label.
10. Playbook authority may narrow existing grants but cannot widen coworker intrinsic authority or
    exceed regulatory policy.
11. Customer 0 evidence is capped to `dpf_dogfood` unless a portable canonical corpus or qualifying
    customer-overlay corroboration is verified.
12. Secrets, full prompts, source code, customer content, and provider credentials never enter
    experiment metadata or fleet evidence.

## Architecture review

The DPF architecture review is `aligned with safeguards`. The plan extends existing build,
execution, evidence, authority, Work Case, merge-queue, and self-upgrade substrates; it does not
introduce a parallel orchestrator, approval store, queue, or deployment path. Three integration
risks found during review are resolved in the tasks below:

1. `TaskRun.taskRunId` is a stable semantic identity while `TaskRun.id` is the database row
   identity. Experiment-owned child rows use deterministic semantic IDs and store the resolved
   parent row `id` in `parentTaskRunId`, matching the existing recovery writer. The experiment
   store owns this rule and tests it; it does not rewrite legacy rows written under older mixed
   conventions.
2. Every new `TaskRun` must have an accountable existing `userId`. The runner resolves the
   initiating/scheduled owner through the existing owner-resolution substrate and fails closed
   when no accountable owner exists; it never invents a sentinel principal.
3. The generic AuthorityBinding editor must not provide a second mutation path around the
   scope-key lock. Work-pattern activation, supersession, rollback, and authority-scope changes
   go only through the specialized activation transaction; the generic editor rejects those
   mutations for `resourceType="work-pattern"`.
4. `apps/web/lib/authority/bindings.ts` (`listAuthorityBindingRecords`) and every consumer of it
   (`/platform/identity/authorization`, `BindingList`, `BindingDetailPanel`,
   `BindingDetailDrawer`) query and render every `AuthorityBinding` row with no `resourceType`
   filter. Every row in the codebase today is `resourceType="route"`, and the rendering assumes
   route-shaped `subjects`/`grants`. Left unfiltered, the first work-pattern binding will surface
   raw binding IDs and scope JSON in that unrelated admin screen the same day Delivery 2 ships,
   contradicting this plan's own "no raw IDs at default altitude" UX guardrail. The read path
   filters `resourceType="work-pattern"` bindings out of the route-authorization surface; it does
   not just guard the write path.
5. `TaskRun.status` already carries a documented, watchdog-consumed A2A lifecycle
   (`submitted | working | input-required | auth-required | completed | failed | canceled |
   rejected | archived`, indexed by `@@index([status, lastHeartbeatAt])`). The experiment manifest
   adds a second lifecycle (`planned -> running -> analyzing -> completed`, `cancelled`) in
   `a2aMetadata.workPatternExperiment.lifecycle` on the same parent row. The two are never allowed
   to diverge silently: each experiment lifecycle value maps to one explicit `TaskRun.status`, and
   the mapping is tested, not left to whichever value the implementer picks when the code is
   written. `planned` remains `submitted` so queued work is not treated as stale in-flight work.

No additional external architecture standard is required for this plan. The approved design has
already grounded the experimental method, while DPF's own operational doctrine is authoritative
for execution identity, authority, merge, deployment, accessibility, and recovery.

## Backlog coverage

- Decision: decomposed
- Parent: `BI-0A636528`
- Receipt: `cms18ltgb05ry01p8eonh32jh`
- Dependencies: `experiment-evidence-runtime` precedes `scoped-promotion-activation`; the autonomous
  consumer depends on both plus the pre-existing `merge-queue-recovery-prerequisite`.
- `merge-queue-recovery-prerequisite` -> `BI-7C4FDBF5`
- `experiment-evidence-runtime` -> `BI-0A636528`
- `scoped-promotion-activation` -> `BI-522E754E`
- `autonomous-build-studio-consumer` -> `BI-356E69B1`

| Deliverable key | Backlog item | Independently shippable | Dependencies |
| --- | --- | --- | --- |
| `merge-queue-recovery-prerequisite` | `BI-7C4FDBF5` | yes, pre-existing work outside this program's 55 units | none |
| `experiment-evidence-runtime` | `BI-0A636528` | yes | none |
| `scoped-promotion-activation` | `BI-522E754E` | yes | `experiment-evidence-runtime` |
| `autonomous-build-studio-consumer` | `BI-356E69B1` | yes | all three preceding deliverables |

Slices 0 and 1 are internal sequencing inside `BI-0A636528`; they ship in one PR because the typed
contracts and compatibility adapter alone do not deliver the BI's experiment-ledger outcome.

Before implementation or resume:

```powershell
# Invoke through the DPF MCP plan-coverage tool, not a local checkbox:
# check_plan_backlog_coverage(
#   itemId="BI-0A636528",
#   planPath="docs/superpowers/plans/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-plan.md",
#   receiptId="cms18ltgb05ry01p8eonh32jh"
# )
```

## UX fit review

- **Decision:** `fits-with-guardrails`
- **Owning area:** Platform
- **Route families:** existing AI Workforce coworker detail and existing Build Studio `/build`
- **Primary personas:** platform operator reviewing working-method evidence; non-technical owner
  overseeing an autonomous build and intervening only when authority or evidence requires it
- **Navigation layer:** existing local tab/panel and existing Build Studio overseer/Engineer-view
  disclosure; no global/section navigation changes
- **Reuse/convergence:** extend `NeedsAndPlaybooksPanel`, Build Studio's existing lead/summary/status
  bands, Engineer-view disclosure, shared status semantics, theme tokens, and progress primitives
- **Source truth:** effective `DecisionShadowLedger` observations, active work-pattern
  `AuthorityBinding`, pure autonomous eligibility projection, existing Build/PR/release records
- **Empty/failure behavior:** no experiment shows the existing candidate state; no active binding
  says the method is still being tested; stale evidence is labeled stale; blocked work shows one
  next governed action; escalation never looks like active progress
- **AI boundary:** status/disclosure controls do not send prompts; routine eligible transitions
  proceed automatically; the existing Work Case/decision surface handles consequential human input
- **Required guardrails:**
  - Default altitude says `Testing a better method`, `Running autonomously`, `Checking the PR`,
    `Waiting for the governed release`, or `Needs your decision`.
  - Raw model IDs, digests, ledger IDs, experiment IDs, policy versions, and branch/SHA detail remain
    in Engineer view or deeper evidence disclosure.
  - Do not add a dashboard, route, tab family, KPI row, local status-color map, or hand-rolled loader.
  - Use shared `StatusBadge`/status intent where a badge is needed and DPF theme/type/spacing tokens
    everywhere.
  - Running/recovery states derive from durable task heartbeat and reconciliation state; no stale
    animation.
  - Mobile defaults to a vertical status narrative with 44px actions; desktop may add compact
    side-by-side comparison. Both light and dark themes must pass.
- **Evidence before merge:** server/component tests, source-truth fixture tests, UX budget/style/module
  guards, keyboard and screen-reader labels, browser verification at mobile/desktop and light/dark,
  plus screenshots attached to the Work Capsule
- **Captured in:** this section and each UI-affecting PR body

## Effort and bounded refactoring budget

The implementation budget is exactly 55 coarse effort units. Exactly 11 units are reserved for
bounded structural refactoring: `11 / 55 = 20%`.

| Slice | Owning BI | Total units | Feature units | Refactor units | Refactor share |
| --- | --- | ---: | ---: | ---: | ---: |
| 0 — contracts and compatibility | `BI-0A636528` | 10 | 8 | 2 | 20% |
| 1 — factorial execution evidence | `BI-0A636528` | 15 | 12 | 3 | 20% |
| 2 — activation and evidence scope | `BI-522E754E` | 10 | 8 | 2 | 20% |
| 3 — autonomous Build Studio consumer | `BI-356E69B1` | 20 | 16 | 4 | 20% |
| **Total** |  | **55** | **44** | **11** | **20%** |

The pre-existing `BI-7C4FDBF5` prerequisite has its own estimate and is not charged to these 55
units. If any slice estimate changes, stop and rebalance both feature and refactor units to preserve
the one-in-five ratio before continuing.

Allowed refactoring:

1. One canonical legacy shadow-trial source parser.
2. Focused execution-profile, outcome-evidence, experiment-identity, and effective-ledger modules.
3. One read-only autonomous eligibility projection while legacy switches remain rollout kill
   switches.
4. One shared recovery classification/budget contract for only the dispatch, review, provider, PR,
   and release seams touched here.
5. Reuse/extraction of the already-governed merge-queue client from `BI-7C4FDBF5`; no duplicate
   GitHub actuation code.
6. Removal of stale comments/copy that assert a human ship click always remains after the new lane
   is proven and enabled.

Out of bounds:

- lifecycle rewrite;
- generic experiment platform;
- watchdog/reconciler redesign;
- UI-wide Build Studio redesign;
- broad `AuthorityBinding` admin redesign;
- unrelated schema cleanup;
- migration of legacy JSON history;
- unrelated tests or module-size cleanup;
- new public enum values;
- direct production deployment.

## Delivery order

```text
BI-7C4FDBF5 reusable merge/recovery contract ───────────────┐
                                                            v
BI-0A636528 contracts + experiment runtime
  -> BI-522E754E deterministic scoped activation
      -> BI-356E69B1 autonomous Build Studio consumer
          -> dogfood shadow
          -> contained low-risk canary
          -> active dpf_dogfood lane
          -> corroborated broader scope only with qualifying evidence
```

Each BI gets a fresh branch from current `origin/main`, its own Work Capsule, one ready non-draft
PR, DCO-signed commits, local merged-code verification, full PR health, merge queue enrollment, and
governed self-upgrade verification. Do not stack all three implementation BIs on the current design
branch.

---

## Delivery 1 — `BI-0A636528`: contracts and factorial experiment evidence

**Budget:** 25 units = 20 feature + 5 refactor (20%)

**Branch intent:** `feat/governed-playbook-experiment-evidence`

### Task 1.0 — revalidate substrate and write failing contract tests

**Read/re-sweep:**

- `packages/db/prisma/schema.prisma`
- `packages/db/src/capability-maturity.ts`
- `apps/web/lib/tak/work-pattern-types.ts`
- `apps/web/lib/tak/work-pattern-shadow-evaluation.ts`
- `apps/web/lib/tak/work-pattern-read-model.ts`
- `apps/web/lib/actions/work-pattern-review.ts`
- `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts`
- `apps/web/lib/integrate/coding-agent.ts`
- `apps/web/lib/integrate/sandbox/build-branch.ts`
- `apps/web/lib/queue/functions/index.ts`

**Tests first:**

- legacy trials duplicated across `evidenceJson` and `readinessJson` normalize and dedupe once;
- execution profiles reject unknown risk/install/lifecycle values and secret-bearing/full-prompt
  fields;
- resolved provider/model is captured after fallback rather than requested provider/model;
- outcome evidence preserves all gate, review, execution, and delivery dimensions;
- experiment definition/run/cell/ledger IDs are deterministic and collision-safe;
- invalid lifecycle transitions and malformed supersession links fail closed.

**Create:**

- `apps/web/lib/tak/work-pattern-experiment-types.ts`
- `apps/web/lib/tak/work-pattern-experiment-types.test.ts`
- `apps/web/lib/tak/work-pattern-experiment-identity.ts`
- `apps/web/lib/tak/work-pattern-experiment-identity.test.ts`
- `apps/web/lib/tak/work-pattern-outcome-evidence.ts`
- `apps/web/lib/tak/work-pattern-outcome-evidence.test.ts`

**Refactor allocation — 2 units:**

- Move legacy multi-source parsing/deduplication into one exported adapter in
  `work-pattern-shadow-evaluation.ts` or a focused `work-pattern-legacy-adapter.ts`.
- Replace the duplicated reads in `work-pattern-read-model.ts` and
  `actions/work-pattern-review.ts`; preserve output byte-for-byte in compatibility fixtures.

**Exit gate:**

- Pure tests are green.
- Existing Living Playbook read/review tests are unchanged except for canonical adapter use.
- No runtime write or activation exists yet.

### Task 1.1 — add the one required additive schema extension

**Modify:**

- `packages/db/prisma/schema.prisma`
  - add nullable `executionProfileRef Json?` to `BuildPhaseRun`;
  - do not change `@@unique([buildId, phase])`.
- Create
  `packages/db/prisma/migrations/<timestamp>_add_build_phase_execution_profile_ref/migration.sql`
  with only the nullable JSON column addition.

**Migration rules:**

- no backfill;
- no default;
- no constraint tightening;
- no mutation of any committed migration;
- apply against a database containing existing `FeatureBuild`, `BuildPhaseRun`, legacy shadow JSON,
  and decision-ledger rows.

**Tests/gates:**

- Prisma validation and generated-client/typecheck coverage;
- migration deploy on an existing-state fixture in the leased local-integration environment;
- old `BuildPhaseRun` rows read with `executionProfileRef = null`;
- new actual build phases can persist and read a compact profile reference.

**Exit gate:**

- fleet-safe additive migration applies cleanly and rollback is a PR revert before fleet rollout;
  after rollout the nullable column is left in place if code must roll back.

### Task 1.2 — implement deterministic parent/child experiment storage

**Create:**

- `apps/web/lib/tak/work-pattern-experiment-store.ts`
- `apps/web/lib/tak/work-pattern-experiment-store.test.ts`
- `apps/web/lib/tak/work-pattern-effective-ledger.ts`
- `apps/web/lib/tak/work-pattern-effective-ledger.test.ts`

**Modify:**

- `apps/web/lib/tak/work-pattern-types.ts` to add only internal typed metadata parsers; retain public
  `observed | candidate | approved | active | retired`.
- `apps/web/lib/tak/autonomous-work-run.ts` only where needed to accept deterministic child identity
  and a compact work-pattern profile without changing general autonomous-run behavior.

**Read/reuse:**

- `apps/web/lib/queue/scheduled-owner.ts` and the existing initiating-user resolution path;
- the current TaskRun recovery writer's parent-row identity convention.

**Implementation requirements:**

1. Allocate `replicate` once under an experiment-definition advisory lock.
2. Resolve an accountable existing `userId`; fail closed before creating the manifest when owner
   resolution cannot prove one.
3. Derive parent `taskRunId` from `experimentRunId`; derive child semantic IDs from
   run/cell/pair/attempt. Resolve the parent row first and write its database `id` to each
   experiment-owned child's `parentTaskRunId`.
4. Use legal lifecycle transitions only:
   `planned -> running -> analyzing -> completed`, plus cancellation and idempotent self-resume.
5. Create missing cells only; never overwrite prior attempts.
6. Write assignment and terminal outcome rows with deterministic `ledgerId`.
7. Correct evidence with a new row containing `supersedesLedgerId` and
   `invalidationReason`; resolve chains with cycle detection.
8. Validate pairs for identical fixture, source SHA, corpus/oracle versions, resource policy, and
   terminal required cells. Invalid pairs remain operational evidence but cannot promote.
9. Store compact profiles/digests only. Bulky artifacts remain in existing task/build artifact
   stores.
10. Attribute every `DecisionShadowLedger.agentId` write to the orchestrating coworker (the
    build's assigned `Agent.id`), never to a candidate model/provider under test. `agentId` is a
    required, non-nullable column; a model being compared is evidence, not the attributing agent.
11. Map every experiment lifecycle value to one explicit parent `TaskRun.status`
    (`planned -> status="submitted"`, `running`/`analyzing -> status="working"`,
    `completed -> status="completed"`, `cancelled -> status="canceled"`) so the row's A2A status and its
    `a2aMetadata.workPatternExperiment.lifecycle` never diverge, and the watchdog's
    `status='working' AND lastHeartbeatAt` staleness check stays meaningful through `analyzing`.

**Tests first:**

- concurrent create converges on one parent and one cell per deterministic identity;
- child semantic identity is deterministic while `parentTaskRunId` consistently contains the
  resolved parent row identity;
- missing or ambiguous accountable-owner resolution fails closed without partial rows;
- explicit replicate creates a new run without rewriting prior history;
- resume schedules only missing/non-terminal work;
- retry increments attempt;
- duplicate ledger writes converge;
- supersession resolution, dangling references, and cycles;
- missing/blocked/cancelled/budget-skewed cells invalidate promotion pairs;
- parent `TaskRun.status` and `a2aMetadata.workPatternExperiment.lifecycle` never diverge across
  every legal lifecycle transition.

**Refactor allocation — 1 unit:**

- Keep identity, transition, and effective-ledger logic pure and shared by runner/read model; do not
  add ad hoc JSON casts at call sites.

**Exit gate:**

- one parent manifest and complete child cell set can be reconstructed entirely from `TaskRun` and
  effective `DecisionShadowLedger` evidence.

### Task 1.3 — execute hermetic factorial cells on existing Build Studio adapters

**Create:**

- `apps/web/lib/integrate/work-pattern-experiment-adapter.ts`
- `apps/web/lib/integrate/work-pattern-experiment-adapter.test.ts`
- `apps/web/lib/queue/functions/work-pattern-experiment.ts`
- `apps/web/lib/queue/functions/work-pattern-experiment.test.ts`

**Modify:**

- `apps/web/lib/queue/functions/index.ts` to register the existing-Inngest function.
- `apps/web/lib/actions/work-pattern-review.ts` to schedule an eligible reviewed candidate for
  experiment; approval still does not activate it.
- `apps/web/lib/integrate/coding-agent.ts` only through injectable/public seams needed to run the
  same task-scoped coding dispatch and oracles in a shadow workspace.
- `apps/web/lib/integrate/sandbox/build-branch.ts` only to derive isolated experiment workspaces from
  the same source SHA; never allow two arms to share a mutable workspace.

**Implementation requirements:**

- The parent/child runner orchestrates; it does not reproduce `runBuildPipeline`.
- The adapter reuses current engine selection, coding dispatch, sandbox branch/worktree, scoped
  test, production-build, review, and artifact contracts.
- Experiment cells do not advance `FeatureBuild.phase`, write `acceptanceMet`, create a PR, join the
  queue, initiate release, or mutate live customer state.
- Actual build execution stamps `TaskRun.a2aMetadata.workPattern.executionProfileRef` and
  `BuildPhaseRun.executionProfileRef`. Experiment cells store their full minimized snapshot in
  ledger metadata and compact TaskRun metadata.
- Replay/shadow uses hermetic fixtures first. Non-replayable brownfield work records matched-cohort
  dimensions and a weaker evidence class.
- Budget and provider fallback outcomes are part of evidence, not hidden retries.

**Tests first:**

- full 2x2 model x method matrix with interaction effect retained;
- identical source/fixture/oracle/resource policy across paired cells;
- separate workspaces for every arm;
- fallback stamps actual provider/model;
- interrupted Inngest function resumes idempotently;
- prohibited side-effect adapters are never called in replay/shadow;
- secret-minimization scan over persisted metadata.

**Refactor allocation — 1 unit:**

- Extract a narrow injectable execution adapter from the existing coding-agent/build-oracle seams;
  do not split or rewrite the general build pipeline.

**Exit gate:**

- a hermetic 2x2 experiment can be interrupted, resumed, and reproduced from versioned inputs;
- its queryable results distinguish method, model, and interaction effects.

### Task 1.4 — project experiment evidence without a new dashboard

**Modify:**

- `apps/web/lib/tak/work-pattern-read-model.ts`
- `apps/web/lib/tak/work-pattern-read-model.test.ts`
- `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`
- `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx`

**UI contract:**

- Default row: `Testing a better method`, valid-pair count, plain-language candidate/baseline result,
  evidence origin, and whether more evidence is needed.
- Disclosure: factor variants, scope, freshness, invalid-pair reason, and evidence references.
- Engineer/detail only: raw IDs, digests, model/profile IDs, oracle/corpus/policy versions.
- Empty legacy patterns remain unchanged.
- Rejected/invalid evidence is visible but never styled as active.

**Tests first:**

- legacy-only, experiment-running, continue, invalid-pair, completed, cancelled, and stale states;
- no raw IDs/jargon at default altitude;
- accessible disclosure names and status semantics;
- no new navigation or prompt-sending action.

**Refactor allocation — 1 unit:**

- Extend the existing read-model projection; do not make the component parse ledger metadata.

**Exit gate:**

- the operator can understand experiment state and evidence scope from the existing Living
  Playbooks home.

### Task 1.5 — measure query plans and complete Delivery 1

Run on representative data in the leased local-integration environment:

- parent `TaskRun` -> children by `parentTaskRunId`;
- build task runs filtered by `buildId,status`;
- ledger observations by `taskRunId`;
- effective observations by activity/risk/time.

Record `EXPLAIN (FORMAT JSON)` evidence. If and only if the measured build/status read requires it:

- add `@@index([buildId, status])` to `TaskRun`;
- add an additive migration
  `packages/db/prisma/migrations/<timestamp>_index_task_run_build_status/migration.sql`;
- rerun migration and query-plan evidence.

The measurement consumes the allocated Slice 1 feature budget whether or not the index is added;
it does not change the 20% refactor ratio.

**Focused gate:**

```powershell
pnpm --filter web exec vitest run `
  lib/tak/work-pattern-experiment-types.test.ts `
  lib/tak/work-pattern-experiment-identity.test.ts `
  lib/tak/work-pattern-outcome-evidence.test.ts `
  lib/tak/work-pattern-experiment-store.test.ts `
  lib/tak/work-pattern-effective-ledger.test.ts `
  lib/integrate/work-pattern-experiment-adapter.test.ts `
  lib/queue/functions/work-pattern-experiment.test.ts `
  lib/tak/work-pattern-shadow-evaluation.test.ts `
  lib/tak/work-pattern-read-model.test.ts `
  lib/actions/work-pattern-review.test.ts
pnpm --filter @dpf/db exec prisma validate
pnpm --filter web typecheck
pnpm --filter web build
node scripts/check-module-size.mjs
```

**Runtime gate:**

- migrate existing-state database;
- run one hermetic paired experiment;
- interrupt after partial cells and resume;
- confirm no build phase/PR/release/customer-state side effect;
- verify Living Playbooks at mobile/desktop and light/dark.

**Delivery 1 exit:**

- migration evidence is green;
- compatibility behavior is preserved;
- experiment evidence is reproducible and queryable;
- no activation path exists;
- docs and Work Capsule evidence are complete;
- PR health is terminal green with zero unresolved review threads before queue entry.

---

## Delivery 2 — `BI-522E754E`: deterministic promotion and scoped activation

**Budget:** 10 units = 8 feature + 2 refactor (20%)

**Branch intent:** `feat/scope-aware-playbook-activation`

**Prerequisite:** Delivery 1 is merged, live through governed self-upgrade, and its coverage/query
evidence is accepted.

### Task 2.0 — write pure policy and scope-ceiling tests

**Create:**

- `apps/web/lib/tak/work-pattern-promotion-policy.ts`
- `apps/web/lib/tak/work-pattern-promotion-policy.test.ts`
- `apps/web/lib/tak/work-pattern-activation-scope.ts`
- `apps/web/lib/tak/work-pattern-activation-scope.test.ts`

**Modify/read:**

- `packages/db/src/capability-maturity.ts`
- `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts`
- `apps/web/lib/tak/work-pattern-effective-ledger.ts`

**Policy contract:**

- repo-owned key/version/owner;
- supported activity/risk classes;
- minimum valid paired samples and required cells;
- objective improvements and non-regression tolerances;
- freshness window;
- evidence-scope transitions;
- rollback requirement;
- deterministic result:
  `continue | activate | reject | rollback | escalate`.

**Tests first:**

- commandment gate regression always blocks;
- critical reproduced finding always blocks;
- speed/cost never offsets correctness/security/migration/customer-impact regression;
- missing sample, stale evidence, invalid pair, or missing rollback target cannot activate;
- dogfood-only evidence caps to same install;
- portable canonical corpus and valid non-dogfood corroboration widen only their proved dimension;
- frontier evidence does not activate a local-model scope;
- regulatory human-control rule returns `escalate`.

### Task 2.1 — activate exactly one scoped binding

**Create:**

- `apps/web/lib/tak/work-pattern-activation.ts`
- `apps/web/lib/tak/work-pattern-activation.test.ts`
- `apps/web/lib/tak/work-pattern-binding-reader.ts`
- `apps/web/lib/tak/work-pattern-binding-reader.test.ts`

**Modify:**

- `apps/web/lib/authority/binding-editor.ts` to reject work-pattern activation, supersession,
  rollback, or authority-scope mutation outside the specialized transaction;
- the binding-editor tests covering that guard;
- `apps/web/lib/authority/bindings.ts` (`listAuthorityBindingRecords`) so `resourceType="work-pattern"`
  rows never reach the `/platform/identity/authorization` admin list or the `BindingList` /
  `BindingDetailPanel` / `BindingDetailDrawer` components, all of which today assume every row is
  `resourceType="route"` and render it unfiltered;
- the bindings-reader tests covering that filter.

**Reuse:**

- `AuthorityBinding` and its existing subjects/grants;
- existing `DecisionInteraction`/Work Case path for escalation.

**Transaction contract:**

1. Compute the scope key server-side from activity, risk, install/organization, corpus, model, and
   pattern version.
2. Enter a serializable transaction and parameterized scope-key advisory lock.
3. Re-read effective evidence, freshness, regulatory ceiling, prior binding, and corroboration.
4. Re-derive maximum activation scope; never accept a caller-supplied unconstrained target.
5. Verify grants do not widen intrinsic coworker authority.
6. Supersede the prior active binding and activate exactly one
   `resourceType="work-pattern"` binding.
7. Record source experiment, policy version, corroboration, and prior safe binding in
   `authorityScope`.
8. Write an immutable ledger observation for activation/rejection/rollback.

**Tests first:**

- concurrent activation yields one active binding;
- stale evidence after lock acquisition fails;
- invalid/dangling/superseded corroboration does not count;
- grant widening fails;
- rollback marks failed binding `rolled-back` and reactivates the prior safe binding under the same
  lock;
- retry is idempotent;
- generic binding-editor calls cannot activate, supersede, roll back, or change the authority
  scope of a work-pattern binding;
- no capability-need JSON is treated as authority;
- a work-pattern binding never appears in `listAuthorityBindingRecords()` output or the
  route-authorization admin list.

**Refactor allocation — 1 unit:**

- one typed binding reader/writer seam for work patterns; preserve generic AuthorityBinding admin
  behavior for every other resource type while closing the competing work-pattern mutation path.

### Task 2.2 — negative knowledge, dedupe, and automatic rollback recommendation

**Modify:**

- `apps/web/lib/tak/work-pattern-effective-ledger.ts`
- `apps/web/lib/tak/work-pattern-promotion-policy.ts`
- `apps/web/lib/tak/work-pattern-read-model.ts`

**Requirements:**

- retain rejected variants and failure classes;
- dedupe materially identical candidates by method/model/corpus/oracle/policy identity;
- allow reopening only with materially new evidence or changed identity;
- identify previous safe version;
- health regression within the same authorized scope may execute rollback;
- broader-scope rollback/escalation still respects regulation and authority.

**Tests first:**

- identical rejected candidate does not re-enter automatically;
- new corpus/model/oracle permits a new replicate without rewriting negative history;
- rollback remains same-scope and append-only;
- supersession chain remains acyclic.

### Task 2.3 — add plain-language activation/scope UX

**Modify:**

- `apps/web/lib/tak/work-pattern-read-model.ts`
- `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx`
- `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx`

**UI contract:**

- show current active version and plain-language scope;
- show evidence origin and freshness;
- say why scope is local and what corroboration is missing;
- show rejection/rollback under disclosure;
- no activate button for policy-cleared routine lanes;
- regulatory/high-risk escalation links to the existing decision/Work Case surface;
- no raw binding/ledger/policy identifiers at default altitude.

**Refactor allocation — 1 unit:**

- centralize blocker/status copy in the read model or a focused presentation mapping; do not add
  local status-color/copy maps to the component.

### Task 2.4 — complete Delivery 2

**Focused gate:**

```powershell
pnpm --filter web exec vitest run `
  lib/tak/work-pattern-promotion-policy.test.ts `
  lib/tak/work-pattern-activation-scope.test.ts `
  lib/tak/work-pattern-activation.test.ts `
  lib/tak/work-pattern-binding-reader.test.ts `
  lib/tak/work-pattern-effective-ledger.test.ts `
  lib/tak/work-pattern-read-model.test.ts `
  'app/(shell)/platform/ai/agent/[agentId]/page.test.tsx'
pnpm --filter web typecheck
pnpm --filter web build
node scripts/check-module-size.mjs
node scripts/check-style-drift.mjs
```

**Runtime gate:**

- promote a qualifying dogfood experiment and confirm its binding is same-install only;
- attempt fleet/archetype activation with only dogfood evidence and confirm transaction rejection;
- add valid portable/corroborating evidence and confirm only the proved dimension widens;
- run two concurrent activation attempts and observe one active binding;
- trigger rollback and confirm previous safe binding plus retained failed evidence;
- confirm `/platform/identity/authorization` shows no work-pattern binding row after activation;
- verify UI at mobile/desktop, light/dark, keyboard-only, and screen-reader label level.

**Delivery 2 exit:**

- deterministic policy and active binding are authoritative;
- local evidence cannot silently become fleet authority;
- rejection/rollback are durable;
- no new approval queue or schema migration exists;
- PR health is green before merge-queue enrollment.

---

## Delivery 3 — `BI-356E69B1`: autonomous Build Studio consumer

**Budget:** 20 units = 16 feature + 4 refactor (20%)

**Branch intent:** `feat/autonomous-build-studio-playbooks`

**Prerequisites:**

- Deliveries 1 and 2 are merged and live.
- `BI-7C4FDBF5` has delivered a reusable Build Studio PR readiness, queue enrollment, safe stale-base
  recovery, true-conflict escalation, and plain-language state contract. If it has not, stop; do
  not recreate that contract inside this BI.

### Task 3.0 — derive one pure eligibility projection

**Create:**

- `apps/web/lib/build/autonomous-build-eligibility.ts`
- `apps/web/lib/build/autonomous-build-eligibility.test.ts`
- `apps/web/lib/build/autonomous-build-eligibility-reader.ts`
- `apps/web/lib/build/autonomous-build-eligibility-reader.test.ts`

**Consume, do not replace:**

- `apps/web/lib/build/one-shot-lane.ts`
- `apps/web/lib/decision-perspective/graduated-autonomy.ts`
- `apps/web/lib/autonomy/regulatory-autonomy-runtime.ts`
- `apps/web/lib/tak/work-pattern-binding-reader.ts`
- `apps/web/lib/integrate/build-engine-selection-runtime.ts`
- existing build gate, sandbox, provider health, PR, release, and deployed-SHA state.

**Projection:**

```ts
type AutonomousBuildEligibility = {
  eligible: boolean;
  lane: "standard" | "one-shot";
  sensitivity: "low" | "elevated" | "high";
  activePatternVersion?: number;
  blockers: string[];
  nextGovernedAction:
    | "auto-start"
    | "continue"
    | "repair"
    | "decompose"
    | "ship"
    | "merge-queue"
    | "await-release"
    | "escalate";
};
```

**Tests first:**

- complete evidence + active in-scope binding + healthy provider/sandbox + low risk is eligible;
- missing/stale attribution, binding mismatch, provider incapability, unavailable oracle, high
  sensitivity, regulatory ceiling, invalid release state, or exhausted budget is ineligible with a
  deterministic next action;
- projection is pure and writes no state;
- one-shot remains limited to approved small/medium lane;
- standard eligible lane may still be autonomous without pretending it is one-shot.

**Refactor allocation — 2 units:**

- replace scattered call-site condition composition with the projection while retaining all legacy
  switches as rollout/emergency kill switches;
- no general flag framework rewrite.

### Task 3.1 — stamp the active method into intake, phase dispatch, and evidence

**Modify:**

- `apps/web/lib/governed-backlog-tee-up.ts`
- `apps/web/lib/integrate/ideate-on-approval.ts`
- `apps/web/lib/integrate/plan-to-build-transition.ts`
- `apps/web/lib/integrate/build-execute-helpers.ts`
- `apps/web/lib/queue/functions/build-execute.ts`
- `apps/web/lib/queue/functions/build-review-verification.ts`
- `apps/web/lib/integrate/ship-on-review-approval.ts`
- `apps/web/instrumentation.ts`

**Requirements:**

- Eligibility is checked immediately before each consequential transition, not once at intake.
- Intake/ideate may auto-start an eligible governed build without `Approve Start`.
- Ideate and plan may revise within declared review bounds.
- Plan advancement uses the existing decision ladder and decomposition gate.
- Build dispatch uses the active method version and stamps resolved execution profile after routing.
- Review separates generation from verification; unreproduced AI claims remain advisory.
- Green evidence plus graduated ship gate may proceed without a routine acceptance/ship click.
- Any re-check that becomes ineligible parks and escalates; prior eligibility is not authority.

**Tests first:**

- eligibility changes between phases are honored;
- no active binding/no attribution never auto-starts;
- low-risk eligible intake reaches ideate dispatch idempotently;
- high-risk start/ship escalates;
- review finding must reproduce before blocking;
- active binding scope mismatch cannot be papered over by a feature flag;
- actual phase rows carry the compact execution-profile reference.

### Task 3.2 — implement bounded, attributable recovery

**Create:**

- `apps/web/lib/build/autonomous-recovery-policy.ts`
- `apps/web/lib/build/autonomous-recovery-policy.test.ts`

**Modify only touched consumers:**

- `apps/web/lib/integrate/build-pipeline.ts`
- `apps/web/lib/integrate/build-engine-selection-runtime.ts`
- `apps/web/lib/integrate/resume-pre-build-phase.ts`
- `apps/web/lib/queue/functions/build-review-verification.ts`
- `apps/web/lib/integrate/ship-on-review-approval.ts`
- `apps/web/instrumentation.ts`

**Versioned default policy:**

| Failure class | Response | Bound |
| --- | --- | ---: |
| Provider/rate limit | backoff, then healthy equivalent provider | 2 provider attempts |
| Tool protocol mismatch | normalize once, then compatible fallback | 1 repair + 1 fallback |
| Context overflow | compact at task boundary and narrow pack | 1 replay |
| Scoped test/type/build failure | diagnose, regression test, repair | 2 rounds |
| Reproduced blocking review finding | repair and fresh re-review | 2 converging rounds |
| Plan oscillation | decompose or return to design with retained findings | 1 decomposition |
| Sandbox drift | classify `blocked_sandbox_drift`; converge governed sandbox | no product-failure charge |
| Post-push CI failure | inspect, classify, repair, locally verify, push new SHA | 2 rounds |
| Queue rejection/stale base | exit queue, safe owned-commit replay, verify, re-enroll | 1 safe replay |
| Unresolved review thread | reproduce/address/request re-review | 2 converging rounds |
| Remote SHA race | compare expected/remote and reconcile | 1 reconciliation |
| Human-closed/replaced PR | honor closure; follow explicit replacement or escalate | no reopen |
| Self-upgrade failure | governed runner retry/rollback and external-blocker classification | runner policy |
| Deployed-SHA timeout | park `await-release`/attention with observed state | 1 bounded window |
| Authority/regulatory ceiling | evidence-backed escalation | no override |
| Budget exhausted | park safely and escalate | terminal |

**Refactor allocation — 2 units:**

- shared failure classification, counters, and next-action mapping across only these consumers;
- watchdog remains a separate consumer and architecture.

**Tests first:**

- every class consumes the correct budget;
- sandbox drift does not consume product repair rounds;
- restart/resume retains counters and completed side effects;
- budget exhaustion emits one deduped escalation;
- no direct Compose/redeploy action is available;
- human closure and ambiguous review feedback cannot self-authorize.

### Task 3.3 — close PR, queue, release, and deployed completion

**Consume prerequisite contract in:**

- `apps/web/lib/integrate/github-api-commit.ts` or the shared merge-queue client delivered by
  `BI-7C4FDBF5`;
- `apps/web/lib/integrate/ship-on-review-approval.ts`;
- `apps/web/lib/build-flow-state.ts`;
- `apps/web/instrumentation.ts`;
- existing self-upgrade queue/completion modules.

**State machine:**

1. Create one ready non-draft PR after local/review gates are green.
2. Run the same PR-health predicates: terminal passing checks, mergeable not conflicting, zero
   unresolved review threads.
3. Enroll in GitHub merge queue; record expected branch/SHA and queue state.
4. Never force-push while queued.
5. If new bytes are required, leave queue, apply bounded safe recovery, rerun gates, push, and
   re-enroll.
6. After merge, join normal governed self-upgrade/release batching.
7. Let the governed runner own backup, image identity, migration, health, rollback, and recovery.
8. Mark complete only when the merged SHA is live and both delivery forks are terminal.

**Tests first:**

- repeated resume creates no duplicate PR or queue request;
- pending checks/review threads do not queue;
- queue rejection follows the prerequisite recovery contract;
- closed/replaced PR is honored;
- release blocker does not trigger direct deployment;
- self-upgrade rollback does not mark build complete;
- deployed-SHA match completes exactly once;
- private/fork-only delivery preserves its existing terminal-fork semantics.

### Task 3.4 — surface autonomous custody and honest attention states

**Create or extend one existing Build Studio band, preferring convergence:**

- Prefer extending `apps/web/components/build/BuildSolutionSummaryBand.tsx` and existing status
  projections.
- Create `BuildAutonomyStatusBand.tsx` only if module-size/semantic boundaries prove the existing
  band cannot own the state without mixing unrelated concerns.

**Modify:**

- `apps/web/lib/explore/feature-build-types.ts`
- `apps/web/lib/explore/feature-build-data.ts`
- `apps/web/components/build/BuildStudio.tsx`
- `apps/web/components/build/BuildStudioHeaderLayout.test.tsx`
- `apps/web/components/build/build-studio-workflow-actions.ts`
- `apps/web/components/build/build-studio-workflow-actions.test.ts`
- relevant focused component test if a new band is justified.

**Default overseer copy:**

- `Running autonomously` + one sentence explaining why it is safe;
- plain recovery activity, e.g. approved provider fallback;
- `Checking the PR`, `Merge queued`, `Waiting for the governed release`, `Deployed`;
- `Needs your decision` only for a real escalation, with one recommended next action.

**Engineer view:**

- method name/version;
- resolved model/provider;
- recovery policy/version and budget use;
- experiment/binding/evidence references;
- exact PR/queue/release/deployed state.

**Tests first:**

- active, recovering, queue-waiting, release-waiting, deployed, stale, and escalated states;
- stale heartbeat never renders `Running autonomously`;
- no raw IDs in default view;
- Engineer view contains required attribution;
- no duplicate action banner or new dashboard/tab;
- semantic headings/status regions, keyboard focus, reduced motion, and theme-token-only styling.

### Task 3.5 — complete Delivery 3

**Focused gate:**

```powershell
pnpm --filter web exec vitest run `
  lib/build/autonomous-build-eligibility.test.ts `
  lib/build/autonomous-build-eligibility-reader.test.ts `
  lib/build/autonomous-recovery-policy.test.ts `
  lib/build/one-shot-lane.test.ts `
  lib/decision-perspective/graduated-autonomy.test.ts `
  lib/integrate/ideate-on-approval.test.ts `
  lib/integrate/plan-to-build-transition.test.ts `
  lib/integrate/build-pipeline.test.ts `
  lib/queue/functions/build-review-verification.test.ts `
  lib/integrate/ship-on-review-approval.test.ts `
  lib/build-flow-state.test.ts `
  instrumentation.test.ts `
  components/build/BuildStudioHeaderLayout.test.tsx
pnpm --filter web typecheck
pnpm --filter web build
node scripts/check-module-size.mjs
node scripts/check-style-drift.mjs
```

**Runtime/UX matrix in leased local integration:**

1. eligible low-risk, active same-install playbook, healthy primary provider;
2. primary provider failure with approved fallback;
3. scoped test failure repaired inside budget;
4. reproduced review finding repaired and re-reviewed;
5. post-push CI failure repaired and safely re-queued;
6. stale-base/queue rejection recovered through `BI-7C4FDBF5`;
7. human-closed PR honored and escalated;
8. governed self-upgrade failure/rollback;
9. deployed-SHA timeout;
10. forced high-risk/regulatory ceiling before ship;
11. exhausted recovery budget;
12. restart at every external side-effect boundary.

For the happy path, verify:

- no routine human click from governed eligible intake through deployed completion;
- all existing gates executed;
- one ready PR, one queue enrollment per SHA, one governed release path, one completion;
- exact execution attribution and recovery evidence;
- mobile/desktop and light/dark UI;
- keyboard order, focus visibility, status announcements, reduced motion, and no default-altitude raw
  identifiers.

**Delivery 3 exit:**

- low-risk eligible fixture completes autonomously;
- high-risk and exhausted-budget fixtures escalate honestly;
- PR queue and self-upgrade remain authoritative;
- UI and docs are verified;
- source-local tests, production build, migration compatibility, runtime verification, and PR health
  are green before merge-queue enrollment.

---

## Rollout sequence

### Stage A — compatibility and dark evidence

- Ship Delivery 1 through the normal merge queue and governed self-upgrade.
- Legacy JSON reads remain enabled.
- New experiment writes use only TaskRun plus DecisionShadowLedger.
- Experiments run only on hermetic replay/shadow fixtures; no activation.
- Observe query volume, metadata size, privacy classification, resume behavior, and invalid-pair
  rates.

**Advance only if:** no compatibility regression, no secret/customer-content leakage, deterministic
resume passes, and query plans remain within recorded bounds.

### Stage B — local scoped activation

- Ship Delivery 2.
- Activate only a qualifying `dpf_dogfood` method with a verified rollback target.
- Keep customer-overlay/canonical/fleet scope mechanically blocked without qualifying evidence.
- Exercise concurrent activation and rollback.

**Advance only if:** one-binding invariant holds, scope ceilings reject overreach, and rollback
restores the prior safe version.

### Stage C — autonomous Build Studio shadow

- Ship Delivery 3 with the eligibility projection evaluating every seam.
- Keep legacy flags as kill switches.
- Record what would auto-start/advance/recover/ship/queue/release without actuating new autonomous
  transitions.

**Advance only if:** shadow decisions agree with existing gates, no hidden human-only seam remains,
and every remote/release side effect has an idempotency/reconciliation test.

### Stage D — contained low-risk canary

- Enable the autonomous consumer for one low-risk `dpf_dogfood` Build Studio lane whose active
  binding covers the activity/model/corpus.
- Run the complete happy path and forced recovery/escalation matrix.
- Watch real PR health, queue, self-upgrade, and deployed-SHA evidence.

**Advance only if:** the build completes with no routine click, no bypass, bounded recovery, honest
UI, and a proven rollback/kill-switch path.

### Stage E — active dogfood lane

- Enable all evidence-cleared low-risk dogfood lanes covered by active bindings.
- High/critical and regulatory ceilings remain escalations.
- Continue collecting experiment and outcome evidence.

### Stage F — broader promotion

- Broaden only after portable canonical corpus or materially different customer-overlay
  corroboration passes the versioned policy.
- Recompute scope for every activation; never infer fleet authority from dogfood success.
- Proceduralization is a separately filed BI after a deterministic behavior repeatedly wins.

## Recovery and rollback scenarios

| Scenario | Required behavior | Rollback/recovery evidence |
| --- | --- | --- |
| Delivery 1 code regression before rollout | Revert PR | Existing JSON reader and nullable schema remain compatible. |
| Delivery 1 after column is fleet-deployed | Revert code, leave nullable column | No destructive down migration; later cleanup is separately planned. |
| Partial experiment | Resume missing cells only | Parent/child state and deterministic IDs prove no duplicates. |
| Bad/corrected observation | Append superseding row | Effective-ledger chain shows original and correction. |
| Promotion policy defect | Disable policy version/consumer and stop new activation | Existing binding remains or rollback transaction restores prior safe version. |
| Concurrent activations | Scope lock serializes and one wins | Transaction test plus one active binding query. |
| Runtime quality regression | Same-scope rollback to prior safe binding | Failed binding marked rolled-back; evidence retained. |
| Provider failure | Bounded fallback | Resolved provider/model and attempt count stamped. |
| Sandbox drift | Governed convergence; no product-failure charge | `blocked_sandbox_drift` evidence and freshness result. |
| CI/review/queue failure | Bounded repair/re-review/re-enrollment | One attempt ledger per SHA; never force-push queued branch. |
| Human closes PR | Honor closure | One escalation; no reopen. |
| Release failure | Governed runner retry/rollback | Recovery point, image identity, health, rollback status. |
| Deployed SHA not observed | Park and escalate after bounded window | Last observed release/deployed state; no false completion. |
| High-risk/regulatory ceiling | Stop before transition | DecisionInteraction/Work Case evidence and recommended decision. |
| Recovery exhausted | Park terminally for the run | Budget ledger and one deduped escalation. |
| Emergency autonomy concern | Disable consumer/legacy rollout flags and roll back active binding | No build-gate, queue, or self-upgrade bypass is needed to stop new autonomy. |

## Documentation impact

Update in the same owning delivery branch when behavior becomes true:

### Delivery 1

- Add implementation/status pointer to
  `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`.
- Update the approved design status/pointers without copying implementation rules.
- Add architecture detail for experiment metadata and evidence retention only if the approved design
  no longer fully describes the shipped contract.

### Delivery 2

- Update `docs/architecture/customer-zero-and-use-case-zero.md` when mechanical activation scope
  enforcement lands.
- Update AI Workforce user guidance for Living Playbook evidence, activation scope, rejection, and
  rollback.

### Delivery 3

- Update `docs/user-guide/build-studio/` for the operator-visible autonomous lane, attention states,
  and what Build Studio may decide itself.
- Rewrite `docs/operations/autonomous-build-completion.md` around the consolidated eligibility,
  recovery, merge-queue, release, kill-switch, and deployed-completion contract.
- Update `docs/architecture/local-llm-build-engine.md` only when model x method routing is active,
  including model-tier evidence limits.
- Cross-link `BI-7C4FDBF5` merge recovery and the governed self-upgrade runbook rather than duplicating
  their mechanics.

No public pre-install positioning change is required until the lane is proven and enabled beyond a
contained dogfood canary. Record that no-docs-needed rationale in any delivery PR that does not yet
make an operator-visible behavior true.

## Program-wide verification gate

Every delivery PR must pass its focused tests plus:

1. affected package unit tests;
2. `pnpm --filter web typecheck`;
3. `pnpm --filter web build`;
4. module-size, style/theme, secret, and relevant UX guards;
5. migration apply for Delivery 1;
6. local merged-code gate through the leased `local-integration-ci` sandbox;
7. sandbox freshness preflight before runtime evidence;
8. UI browser verification for UI-affecting slices;
9. DCO-signed commits, pushed branch, ready non-draft PR;
10. `pnpm pr:health <pr>` terminal green with zero unresolved review threads;
11. GitHub merge queue;
12. governed self-upgrade and deployed-SHA verification before claiming runtime behavior live.

The implementation worker must record actual commands, branch/SHA, lease/freshness result, test
counts, screenshots, migration state, PR health, queue state, release run, and deployed SHA on the
owning Work Capsule. An unrun gate is not a pass.

## Plan review checklist

- [ ] Operator approves this implementation plan.
- [ ] Exact 55/11 effort allocation and 20% refactor boundary are accepted.
- [ ] Three-BI delivery chain and `BI-7C4FDBF5` prerequisite are accepted.
- [ ] Nullable `BuildPhaseRun.executionProfileRef` migration is accepted.
- [ ] No experiment/trial table, second scheduler, second authority rail, or new public status enum
      is introduced.
- [ ] UX fit guardrails are accepted.
- [ ] Rollout and kill-switch sequence is accepted.
- [ ] No implementation begins until all preceding review items are resolved.
