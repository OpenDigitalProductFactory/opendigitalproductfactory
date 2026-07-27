# Build Studio PR Readiness and Merge Recovery Implementation Plan

**Status:** Approved by the operator on 2026-07-27; implementation in progress.

**Backlog item:** `BI-7C4FDBF5`

**Work Capsule:** `WC-09CA9C58`

**Branch / worktree:** `feat/build-studio-pr-recovery` / `D:\DPF-worktrees\build-studio-pr-recovery`

**Plan backlog coverage:** atomic receipt `cms2q28mg0dqe01qqyggqaaem`

**Architecture review:** Passed on 2026-07-27 with the conditions encoded in this plan: exact-head evidence, no direct merge or force-push, Work Capsule coordination rather than a parallel lifecycle, fail-closed ambiguity, merge distinct from deployment, and shadow-first rollout.

## Outcome

Build Studio hands every eligible, evidence-cleared pull request to the repository merge queue, follows it through stale-base recovery and merge, and reports an honest plain-language delivery state. It never directly merges, force-pushes a queued branch, treats PR merge as deployment, or invents a second release path. True conflicts, closed/replaced pull requests, exhausted retry budgets, ambiguous GitHub state, and authority-ceiling cases escalate through the existing human-escalation substrate.

This is the prerequisite named by Delivery 3 of
`docs/superpowers/plans/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-plan.md`.
The autonomous playbook consumer in `BI-356E69B1` remains blocked until this plan is implemented and verified.

## Current-state correction

The older design,
`docs/superpowers/specs/2026-06-19-build-studio-pr-merge-resolution-design.md`,
predates the repository's protected merge queue. Current `main` already has queue policy and merge automation. This BI therefore does not create a new merge substrate. It replaces Build Studio's obsolete direct-merge call with a reusable consumer of the existing queue and makes that consumer restart-safe.

Current code findings:

- `apps/web/lib/mcp/build-ship-handlers.ts` calls `mergePR` directly and records a terminal manual-merge message on failure.
- `apps/web/lib/integrate/github-api-commit.ts` exposes PR status, but no caller uses it for Build Studio delivery; its combined-status lookup is keyed by PR number instead of the PR head SHA.
- `apps/web/lib/integrate/ship-on-review-approval.ts` creates or observes the PR but does not own queue enrollment or stale-base recovery.
- `apps/web/lib/assurance/remediation-merge-live.ts` already contains a GraphQL client and auto-merge mutation that should become shared substrate.
- `WorkCapsule.workspaceState`, PR identity fields, capsule activity, `FeatureBuild`, and the existing bounded escalation helper are sufficient. No new table or public status enum is required.
- The current customer status projection treats PR creation too much like shipping; it does not distinguish checks, queueing, merge, governed release, and deployment.

## Standards and safety contract

The implementation follows GitHub's protected-branch workflow:

- Auto-merge/merge-queue enrollment is the actuation mechanism; repository checks and review policy remain authoritative.
- Readiness is evaluated at the exact current `headRefOid`, not at a PR number or stale cached SHA.
- A stale-branch update uses GitHub's update-branch endpoint with `expected_head_sha`; a changed head returns `422` and is re-observed rather than overwritten.
- `mergeStateStatus` is advisory, not sufficient. Queue enrollment additionally requires every observed check to be terminal and passing and zero unresolved review threads.
- A successful PR merge advances delivery only to “waiting for governed release.” The existing governed self-upgrade and deployed-version reconciliation remain authoritative for “deployed.”

References:

- https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request
- https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request-branch

## Preserved substrates and ownership

- `FeatureBuild` remains the build lifecycle authority.
- `TaskRun` and `BuildPhaseRun` remain execution and phase evidence.
- `DecisionShadowLedger` and `AuthorityBinding` remain decision and authority evidence; this BI does not weaken their ceilings.
- `WorkCase` remains the governed work record.
- `WorkCapsule` owns durable external-delivery coordination and recovery state.
- GitHub's protected branch and merge queue own integration.
- Governed self-upgrade owns deployment, recovery points, health evidence, and rollback.
- Existing `escalateBuildToHuman` owns bounded, deduplicated human escalation.

## Backlog coverage

- Decision: atomic
- Parent: `BI-7C4FDBF5`
- Receipt: `cms2xz0h4014g01l7lumlp0ge`
- Dependencies: Shared readiness → durable reconciler → customer projection → controlled rollout and verification.
- Rationale: Every slice is non-independently shippable. Queue actuation without durable reconciliation can strand or duplicate delivery; reconciliation without exact-SHA readiness can accept stale evidence; customer projection without authoritative state can mislead; and enforcement without controlled rollout and verification is unsafe.

| Deliverable | Dependency | Independently shippable |
|---|---|---:|
| Shared exact-SHA PR readiness and queue actuation | None | No |
| Durable Build Studio delivery reconciler | Shared readiness | No |
| Honest customer delivery projection | Reconciler | No |
| Controlled rollout and verification | All prior work | No |

Queue actuation without durable reconciliation can duplicate or strand delivery. Reconciliation without exact-SHA readiness can bypass current evidence. UI projection without authoritative state can mislead operators. Enforcement without rollout and recovery evidence is unsafe.

## Effort budget

Use 15 implementation units exactly:

| Allocation | Units | Share |
|---|---:|---:|
| Product behavior, tests, UX, documentation, rollout | 12 | 80% |
| Bounded structural refactoring | 3 | 20% |

The three refactoring units are bounded to:

1. Extract the assurance-only GitHub GraphQL/readiness/auto-merge code into one shared integration module (2 units).
2. Converge Build Studio's two ship entry points on one delivery reconciler and one status projection (1 unit).

Excluded refactoring: a general GitHub SDK rewrite, queue-engine redesign, schema normalization, FeatureBuild state-machine replacement, or unrelated Build Studio cleanup.

## Slice 1 — Shared exact-SHA PR readiness contract

**Files**

- Create `apps/web/lib/integrate/github-pr-readiness.ts`.
- Create `apps/web/lib/integrate/github-pr-readiness.test.ts`.
- Modify `apps/web/lib/integrate/github-api-commit.ts`.
- Modify `apps/web/lib/integrate/github-api-commit.test.ts`.
- Modify `apps/web/lib/assurance/remediation-merge-live.ts`.
- Modify `apps/web/lib/assurance/remediation-merge-live.test.ts`.

**Tasks**

1. Write failing unit tests for the pure readiness projection:
   - open and current, all checks passing, zero unresolved threads;
   - pending, skipped/neutral, failing, and missing check rollups;
   - behind/stale;
   - dirty/conflicting;
   - closed-unmerged and merged;
   - unknown/unstable GitHub states;
   - head SHA changes between observation and actuation.
2. Extract a shared typed GitHub GraphQL request helper and PR observation query returning PR node ID, state, merge state, merge/queue state where exposed, `headRefOid`, check rollup, and unresolved review-thread count.
3. Add `updatePullRequestBranch({ expectedHeadSha })` through the documented REST endpoint. Treat `202` as accepted, `422` as compare-and-swap loss requiring re-observation, and other failures as typed recoverable or terminal errors.
4. Move auto-merge enablement into the shared module and preserve the assurance consumer's behavior.
5. Correct any remaining commit/check lookup to use the observed head SHA rather than PR number.
6. Keep the existing direct merge API available only for unrelated explicit consumers; Build Studio must have no dependency on it.

**Exit gate**

- The readiness decision is a pure, exhaustive, unit-tested projection.
- Every mutating GitHub call carries the observed PR identity and exact head SHA.
- Assurance tests prove the extraction is behavior-preserving.
- No Build Studio production path is switched yet.

## Slice 2 — Durable Build Studio delivery state

**Files**

- Create `apps/web/lib/build/build-pr-delivery-state.ts`.
- Create `apps/web/lib/build/build-pr-delivery-state.test.ts`.
- Modify `apps/web/lib/build/capture-build-pr.ts`.
- Modify `apps/web/lib/build/capture-build-pr.test.ts`.

**Tasks**

1. Define a versioned internal `BuildPrDeliveryStateV1` stored under
   `WorkCapsule.workspaceState.buildStudio.delivery`.
2. Persist only recovery-critical coordination fields:
   - schema version;
   - state: `created`, `checking`, `updating`, `queued`, `merged`, `awaiting-release`, `deployed`, `escalated`, or `closed`;
   - PR number, URL, and repository;
   - last observed and last actuated head SHA;
   - stale-update and reconciliation counters;
   - last readiness verdict and observation timestamp;
   - dedupe keys for queue actuation and escalation;
   - last recoverable error classification.
3. Provide parse/upgrade helpers that fail closed on malformed or future-version state.
4. Initialize delivery state when `captureBuildPullRequest` binds PR identity to the capsule.
5. Make state transitions compare-and-swap-safe inside the existing Prisma transaction pattern so retries and overlapping observers cannot duplicate actuation.

**Migration decision**

No Prisma migration. Existing `WorkCapsule.workspaceState` JSON, PR fields, and activity streams are the intended durable coordination substrate. A migration would duplicate ownership and increase fleet-upgrade risk.

**Exit gate**

- A process restart can reconstruct the next safe action from the capsule alone plus a fresh GitHub observation.
- Replayed writes and duplicate observations are idempotent.
- Malformed state parks and escalates; it never actuates GitHub.

## Slice 3 — Bounded delivery reconciler and recovery watcher

**Files**

- Create `apps/web/lib/build/build-pr-delivery-reconciler.ts`.
- Create `apps/web/lib/build/build-pr-delivery-reconciler.test.ts`.
- Create `apps/web/lib/queue/functions/build-pr-delivery-reconcile.ts`.
- Create `apps/web/lib/queue/functions/build-pr-delivery-reconcile.test.ts`.
- Modify `apps/web/lib/queue/functions/index.ts`.
- Modify `apps/web/lib/queue/functions/index.test.ts`.
- Modify `apps/web/lib/operate/scheduled-jobs/catalog.ts` and its parity tests.
- Modify `apps/web/lib/mcp/build-ship-handlers.ts` and focused tests.
- Modify `apps/web/lib/integrate/ship-on-review-approval.ts`.
- Modify `apps/web/lib/integrate/ship-on-review-approval.test.ts`.

**Tasks**

1. Write failing table tests for every observation/action pair before implementation.
2. Implement one injectable reconciler used by both ship entry points and the watcher.
3. Apply the bounded rules:
   - closed and unmerged: honor the human action, record `closed`, and escalate once;
   - merged: record `awaiting-release`; do not complete or deploy the build;
   - current with pending/failing checks or unresolved threads: record `checking` and wait;
   - behind with update budget remaining: update once at the expected head SHA, record `updating`, and require a fresh observation/check run;
   - dirty/conflicting: classify as a true conflict and escalate once with the PR, head SHA, and reason;
   - evidence-cleared and current: enable auto-merge/queue enrollment exactly once per head SHA;
   - unknown or repeatedly unstable: wait for a bounded number of observations, then escalate;
   - changed head after observation: discard the decision and re-observe.
4. Remove Build Studio's direct `mergePR` call and the terminal “manual review and merge” dead end.
5. Have PR creation/review approval trigger an immediate reconciliation attempt.
6. Add a quiescence-aware scheduled recovery pass over active ship-phase Build Studio capsules. Register it through the existing scheduled-function catalog and use a cadence no faster than the repository's allowed cron policy.
7. Preserve `DPF_AUTO_COMPLETE_VERIFIED_BUILDS` as the outer automation kill switch and add a narrowly scoped mode:
   `DPF_BUILD_PR_DELIVERY_RECONCILER_MODE=off|shadow|enforce`.
   Default to `shadow` for rollout; invalid values fail closed to `off`.
8. Emit structured activity/telemetry for observations, actions, retries, compare-and-swap losses, escalations, and latency without logging credentials or raw API payloads.

**Exit gate**

- No Build Studio path directly merges a PR.
- Restarts at every side-effect boundary converge without duplicate updates, queue requests, or escalations.
- The watcher recovers abandoned in-process work from durable state.
- High-risk, conflicting, closed, ambiguous, and exhausted-budget cases escalate.
- Shadow mode performs no GitHub mutation.

## Slice 4 — Honest delivery projection and UX

**Files**

- Modify `apps/web/lib/build-flow-state.ts`.
- Modify `apps/web/lib/build-flow-state.test.ts`.
- Modify `apps/web/lib/build/customer-status-loader.ts`.
- Modify `apps/web/lib/build/customer-status-loader.test.ts`.
- Modify `apps/web/lib/build/customer-status-projection.ts`.
- Modify `apps/web/lib/build/customer-status-projection.test.ts`.
- Modify `apps/web/components/build/BuildCustomerStatusBand.tsx` only if its existing rendering contract cannot express the states.
- Modify `apps/web/components/build/BuildCustomerStatusBand.test.tsx`.
- Modify the closest existing operational-detail component and test only if needed to expose recovery diagnostics without creating a new dashboard.

**Tasks**

1. Project capsule delivery state through the existing customer-status band:
   - `checking`: “Checking the pull request”
   - `updating`: “Finalizing against the latest platform”
   - `queued`: “Merge queued”
   - `merged` / `awaiting-release`: “Waiting for governed release”
   - `deployed`: “Deployed”
   - `escalated` / `closed`: “Needs your decision”
2. Stop projecting PR creation as shipped or deployed.
3. Keep the first viewport customer-readable. Put SHA, retry count, last observation, and exact escalation reason in the existing engineer/operational detail surface, not in the primary status sentence.
4. Preserve accessible status semantics, keyboard reachability, responsive wrapping, and light/dark contrast.

**UX verification**

Exercise the running portal in the leased `local-integration-ci` environment for:

- pending checks;
- stale-head update in progress;
- queued;
- merged but not yet released;
- deployed after governed release evidence;
- true conflict;
- human-closed PR;
- exhausted/ambiguous recovery.

Capture desktop and mobile evidence in light and dark themes. Confirm the status is understandable without Git terminology in the primary sentence, no layout shift obscures actions, keyboard navigation remains ordered, and screen-reader status announcements are not duplicated.

**Exit gate**

- Operators can distinguish checking, queued, merged, released, and deployed.
- Engineers can diagnose recovery without database access.
- No second status band or competing delivery authority is introduced.

## Slice 5 — Documentation, rollout, and completion evidence

**Files**

- Update `docs/superpowers/specs/2026-06-19-build-studio-pr-merge-resolution-design.md` to mark the current merge-queue correction and implementation status.
- Update `docs/operations/autonomous-build-completion.md`.
- Update the relevant Build Studio operator page under `docs/user-guide/`.
- Update `docs/superpowers/plans/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-plan.md` only after the prerequisite is merged, changing Delivery 3's prerequisite evidence from pending to delivered.

**Rollout sequence**

1. `off`: deploy code with no watcher actuation.
2. `shadow`: observe and persist proposed actions; compare them with actual GitHub state and existing human outcomes.
3. Contained canary: `enforce` for evidence-cleared Build Studio builds only; retain authority/risk escalation.
4. General eligible-lane enforcement after canary recovery cases and UX evidence pass.
5. Keep off/shadow as operational rollback modes. Disabling enforcement leaves PRs in GitHub's existing state and does not require schema rollback.

**Verification**

- Focused Vitest suites for every modified module.
- Queue function catalog/parity and every-minute-cron guard.
- `pnpm --filter web typecheck`.
- `pnpm --filter web build`.
- `pnpm run pregate` against the exact branch SHA after acquiring the shared `local-integration-ci` lease and running its freshness preflight.
- UX cases above on the leased runtime.
- `pnpm pr:health <PR>` before claiming merge readiness.
- Post-merge observation that the PR entered and completed through the repository queue.
- Governed release observation proving “deployed” appears only after the live version evidence advances.

**Exit gate**

- All build gates pass with exact-SHA evidence.
- Recovery cases are captured in the PR evidence.
- Documentation describes the real queue/recovery/release contract.
- The BI and Work Capsule are not completed until the PR is merged and live backlog state is updated.

## Explicit recovery scenarios

| Scenario | Required behavior |
|---|---|
| Process stops before state write | Fresh observation repeats safely; no actuation was recorded or assumed |
| Process stops after update-branch request | Re-observe head SHA; never blindly repeat against a changed head |
| Process stops after queue enrollment | Detect queued/auto-merge state and record it; do not enqueue twice |
| Main advances while checks run | Re-observe; update only with the exact previous head SHA |
| Check becomes red after prior green | Park; queue policy remains authoritative; do not bypass |
| Review thread reopens | Return to checking; do not treat previous clearance as current |
| True merge conflict | Escalate once with evidence; no AI force-push or speculative conflict edit |
| Human closes/replaces PR | Honor closure; never recreate automatically in this BI |
| GitHub API rate limit/outage | Persist recoverable error and retry within budget; escalate after exhaustion |
| Capsule state malformed/future version | Fail closed and escalate |
| PR merged but release blocked | Remain “Waiting for governed release”; do not claim deployment |
| Reconciler mode disabled | Preserve state and human/GitHub control; perform no mutation |

## Architecture review record

The plan was checked against the live code, the approved autonomous Build Studio program plan, the older merge-resolution design, and the current repository integration rules.

**Verdict:** aligned and ready for operator review.

**Findings resolved in this revision**

1. The 2026-06-19 design assumed merge orchestration still needed to be invented. Current `main` already has a protected merge queue, so this plan makes Build Studio a governed queue consumer.
2. The assurance domain already contains GraphQL auto-merge substrate. Extracting it prevents a second GitHub integration implementation while preserving assurance behavior.
3. `FeatureBuild` is not the right home for transient PR recovery counters. Versioned Work Capsule state preserves lifecycle ownership and avoids a migration.
4. GitHub merge state alone is not an evidence gate. The plan requires exact-head checks, zero unresolved review threads, and compare-and-swap branch updates.
5. A merged PR is not a deployed feature. The UI and reconciler remain subordinate to governed self-upgrade and deployed-version evidence.
6. Automatic conflict editing would exceed the safe scope of this prerequisite. True conflicts are evidence-rich escalation cases; future autonomous conflict repair requires a separate governed design.

**Residual risks controlled by rollout**

- GitHub API shape, rate limits, or merge-queue state can be incomplete or transient. Unknown observations wait within a budget and then fail closed.
- Overlapping immediate and scheduled reconciliation can race. Durable dedupe keys and exact-head compare-and-swap semantics make replay safe.
- A shadow decision can differ from repository policy. Shadow telemetry is compared with actual outcomes before enforcement.
- Customer wording can imply completion too early. Runtime UX verification covers merged-but-unreleased and deployed states separately.

## Approval gate

The operator approved this plan on 2026-07-27. Approval authorizes the five slices above, the exact 20% bounded refactoring allocation, the no-migration decision, and the shadow-to-enforced rollout. Any later need for a schema migration, a new public lifecycle enum, automatic AI conflict editing, force-push, direct merge, or a separate deployment path requires a new design decision and renewed approval.

## UX fit review — Build Studio PR delivery recovery

- **Decision:** fits with guardrails, now encoded in Slice 4.
- **Owning area:** Platform.
- **Route family:** existing `/build` Build Studio surface.
- **Primary persona:** founder/operator monitoring autonomous delivery; technical diagnostics remain available to the contributor/platform operator.
- **Navigation layer touched:** none; this is an existing in-page status projection.
- **Reuse/convergence:** reuse `BuildCustomerStatusBand` and the existing customer-status loader/projection. No new dashboard, route, tab, badge family, or report component.
- **Source truth:** versioned `WorkCapsule.workspaceState.buildStudio.delivery`, projected under `FeatureBuild` lifecycle authority.
- **Empty/failure behavior:** missing or malformed delivery state fails closed to existing phase/capsule status; conflicts, closure, and exhausted recovery show “Needs your decision.”
- **AI boundary:** status rendering sends no prompt and starts no coworker action.
- **Evidence before merge:** projection/loader tests, source-truth tests, theme/style guards, desktop/mobile light/dark browser verification, keyboard and live-region review.
- **Captured in:** this section and Slice 4.
