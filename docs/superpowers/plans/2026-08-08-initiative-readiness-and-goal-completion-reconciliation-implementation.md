---
status: binding
---

# Initiative Readiness and Goal-Completion Reconciliation — Implementation Plan

- **Date:** 2026-08-08
- **Status:** Approved for implementation
- **Parent backlog item:** BI-CF5A1078
- **Epic:** EP-129D11FD
- **Approved design:** `docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`
- **Original approved design commit:** `c7c54771e4a`; the current immutable locator is recorded by the fresh governed reconciliation receipts
- **Spec-review evidence:** `cmskyl2mw053501o1ql6cta3y`
- **Decomposition decision:** DI-7BE7FE938FF8 — `five_contract_slices`, high confidence, composite 16.149, margin 0.969
- **Overall blocking dependency:** PR #4451's merged, independently reviewed equivalent pre-mutation Workroom claim protection

## 1. Delivery decision

Implement the approved design as five contract-owned child BIs and ready PRs. Each child receives its own branch, governed WorkCapsule, sibling worktree, DCO commits, focused build gate, exact-tree local integration evidence, and independent semantic review. The parent remains in progress until every child and every separately linked blocking dependency is terminal with live evidence.

The sequence is foundation first, then entry and terminal adapters, then TaskRun convergence, then UI/rollout. Parallel implementation is permitted only after the foundation contract is stable and committed; no child may copy evaluator logic or create a local evidence rail.

| Key | Backlog item | Independently shippable concern | Depends on |
|---|---|---|---|
| FND | Delivered in PR #4348 (no recovered live BI) | Shared policy, canonical baselines, receipts, retention pins, migration, and read projection | — |
| ENTRY | BI-4D756545 | Recommendation, claim, and Build Studio entry/phase enforcement | FND |
| TERM | BI-B770A083 | Canonical terminal-transition repository for BI/Epic/FeatureBuild/WorkCapsule | FND |
| TASK | BI-441BECAC | TaskRun success-writer convergence and objective reconciliation | FND, TERM |
| UX | BI-812AC0D8 | Existing-route UX, observability, documentation, and enforcement rollout | ENTRY, TERM, TASK |

The separate Workroom-adoption defect is not absorbed by these deliverables. ENTRY integrated the independently reviewed equivalent guard in PR #4451; the parent/external goal still requires that merged regression evidence.

## 2. Shared implementation rules

1. Start each child from current `origin/main`; never continue production work on this parent documentation branch.
2. Re-read its exact WorkCapsule and branch/worktree/executor/session tuple before editing.
3. Use TDD: add the focused failing regression first, run it red, implement the minimum contract, run it green, then refactor.
4. Keep `evaluateInitiativeReadiness` pure. Database reads, authority, artifact resolution, persistence, rendering, and mutation stay in adapters/repositories.
5. Never infer an approval from prose, generic Build Studio JSON, caller-supplied digest, caller-supplied objective verdict, or agent success text.
6. All UI uses existing components and `--dpf-*` tokens. No new route, dashboard, card system, status narrator, or hardcoded color.
7. A child cannot claim completion with an observation-only adapter, a known direct terminal writer, an unresolved blocking review finding, skipped runtime verification, or missing documentation-impact disposition.
8. Exactly 20% of implementation capacity is reserved for the touched-seam refactors in §9; record the actual refactor tasks in child evidence.

### 2.1 Verified terminal-writer inventory

The source invariant starts from this verified inventory; implementation may add a newly discovered writer but may not defer discovery of these known writers:

| Target | Current writer/door | Current terminal state | Owning slice/test obligation |
|---|---|---|---|
| BacklogItem | `apps/web/lib/actions/backlog.ts` | `done` through server action | TERM characterization + repository route |
| BacklogItem | `apps/web/lib/mcp/packs/backlog-pack.ts` and `apps/web/lib/mcp-handlers/update-backlog-item.ts` | `done` through MCP status tools | TERM characterization + repository route |
| BacklogItem | `apps/web/app/api/v1/ops/backlog/[id]/route.ts` | caller-selected status including `done` | TERM REST regression + repository route |
| Epic | `apps/web/lib/actions/backlog.ts` | automatic `done` when children terminal | TERM objective/child reconciliation test |
| Epic | `apps/web/lib/mcp/packs/backlog-pack.ts` | automatic `done` from MCP update/retire paths | TERM objective/child reconciliation test |
| Epic | `apps/web/app/api/v1/ops/epics/[id]/route.ts` | caller-selected status including `done` | TERM REST regression + repository route |
| FeatureBuild | `apps/web/lib/actions/build.ts::completeBuild` plus MCP lifecycle/ship handlers | phase `complete` | TERM current-revision/evidence/CAS test |
| FeatureBuild | `apps/web/lib/build-flow-state.ts` | direct phase `complete` transition | TERM build-flow-state characterization + repository route |
| WorkCapsule | `apps/web/lib/work-capsules/work-capsule-store.ts::updateWorkCapsuleStatus` and `apps/web/lib/work-capsules/mcp-handlers.ts` | status `complete` | TERM exact subject/executor test |
| WorkCapsule | `apps/web/lib/build/capture-build-pr.ts` and `apps/web/lib/queue/functions/build-pr-delivery-reconcile.ts` | delivery reconciliation can update terminal capsule state | TERM queue/reconcile regression |
| TaskRun | `apps/web/lib/actions/agent-task-scheduler.ts` | `completed` | TASK scheduled-run test |
| TaskRun | `apps/web/lib/actions/agent-thread-dispatcher-runtime.ts` | `completed` | TASK child-thread test |
| TaskRun | `apps/web/lib/mcp-task-submit.ts` | `completed` | TASK remote-MCP test |
| TaskRun | `apps/web/lib/queue/functions/brand-extract.ts` | `completed` | TASK queue-function test |
| TaskRun | `apps/web/lib/queue/functions/deliberation-run.ts` | `completed` | TASK deliberation test |
| TaskRun | `apps/web/lib/deliberation/orchestrator.ts::settleBootstrapTaskRun` | `completed` | TASK bootstrap-deliberation test |
| TaskRun | `apps/web/lib/integrate/build-execute-helpers.ts::finalizeDurableBuild` | `completed` | TASK durable-build test |
| TaskRun | `apps/web/lib/tak/pattern-observer/core.ts` | `completed` | TASK pattern-observer test |
| TaskRun | `apps/web/lib/tak/pattern-observer/periodic-review.ts` and `apps/web/lib/tak/work-pattern-profile-review.ts` | injected `completeTaskRun` adapter writes `completed` | TASK adapter test and migration to canonical boundary |
| TaskRun | `apps/web/lib/integrate/work-pattern-experiment-runtime.ts` | result-derived `completed` through `updateTaskRun` | TASK experiment-runtime test |
| TaskRun | `apps/web/lib/tak/work-pattern-experiment-store.ts::transitionWorkPatternExperiment`, invoked by `apps/web/lib/queue/functions/work-pattern-experiment.ts` | parent experiment lifecycle maps directly to `completed` | TASK parent-experiment characterization + canonical boundary migration |
| TaskRun | `apps/web/lib/operate/mcp-call-efficiency/aiops-handoff.ts` | creates an already-`completed` run | TASK AI-ops handoff creation test; create nonterminal then use boundary |
| TaskRun | `apps/web/lib/operate/a2a-collaboration-health/aiops-handoff.ts` | creates an already-`completed` run | TASK A2A health handoff creation test; create nonterminal then use boundary |
| TaskRun | `apps/web/lib/skills/curator.ts` | creates an already-`completed` run | TASK skill-curator creation test; create nonterminal then use boundary |

The invariant scans production source, not only this table. Reads, failure/cancel/recovery writes, and unrelated domain models named `completed` are excluded explicitly so the guard stays precise.

## 3. Slice FND — delivered in PR #4348

### 3.1 Red tests: policy and receipt trust

Add focused tests before implementation:

- `apps/web/lib/backlog/initiative-readiness-policy.test.ts`
  - provisional feature/archetype capture allows design but denies plan/implementation/completion;
  - missing, malformed, stale, newest-fail, and not-applicable evidence semantics;
  - monotonic strongest-profile selection and downgrade denial;
  - every stable requirement/denial code;
  - veterinary incident fixture misses all four archetype provisioning dimensions.
- `apps/web/lib/backlog/initiative-readiness-receipts.test.ts`
  - one reviewer grant cannot write another gate;
  - superuser and equal/null author/reviewer identities cannot self-approve;
  - generic Build Studio JSON is advisory only;
  - artifact digest/author/subject are server resolved;
  - missing, ambiguous, spoofed provider author returns `ARTIFACT_AUTHOR_REQUIRED`;
  - a caller objective mapping is a proposal, never a completion pass.
  - specialist `not-applicable` requires the same authenticated authority, artifact binding, independence, and no-open-finding checks as pass/fail.
  - stable finding IDs bind to lane, current artifact revision, and normalized issue; pass is impossible with unresolved blockers; resolution is append-only and names prior finding refs.
- `apps/web/lib/backlog/initiative-scope-baseline.test.ts`
  - server parses every `OBJ-*`/`AC-*` marker, anchors and digests exact bytes;
  - invalid anchors, omitted/duplicate IDs, unlinked acceptance, wrong digest, and caller manifests fail;
  - `approvalReceiptId` must be the same-transaction current-digest spec-approval receipt;
  - row lock/current-head CAS rejects initial ambiguity and chain forks;
  - scope-reducing supersession requires independent per-statement disposition.
- `apps/web/lib/backlog/initiative-artifact-retention.test.ts`
  - pin creation is atomic with baseline approval;
  - BuildArtifactRevision, DocumentVersion, DocumentBlob, FeatureBuild cascade, creator delete, document/blob/storage GC, and retention sweep cannot remove current or superseded evidence;
  - provider blob archive digest mismatch rolls back approval.
  - a permanent authority snapshot remains interpretable after the ordinary AuthorizationDecisionLog retention cutoff and while held.
- `apps/web/lib/backlog/initiative-governance-deletion.test.ts`
  - ordinary activity-only backlog deletion remains supported;
  - governance-bearing BacklogItem/Epic deletion is refused by server action, REST doors, and the database trigger;
  - governance activities and retention pins reject update/delete directly and through cleanup paths;
  - active/archived/held records are excluded from retention sweep and no release path exists in this slice.
- `apps/web/lib/backlog/initiative-readiness-projection.test.ts`
  - long histories return one newest row per item/gate, bounded by `items × gates`;
  - malformed newest row never revives an older pass;
  - restricted evidence returns sanitized state and no opaque locator.
- `apps/web/lib/work-capsule-intent.test.ts`
  - `work-intent-declared` tuple/parity, append-only behavior, and `(recordedAt DESC, id DESC)` tie break.
- `apps/web/lib/planning/plan-backlog-coverage.test.ts`
  - legacy version 1 remains readable for visibility but cannot satisfy governed implementation;
  - version 2 binds immutable plan artifact identity/digest and requires requirement, contract, flow, and verification refs on every deliverable;
  - unknown items, missing refs, stale plan digest, unmapped deliverables, and dependency cycles fail;
  - dependency statuses and explicit deferred/not-applicable dispositions project deterministically.

### 3.2 Schema and migration

Edit `packages/db/prisma/schema.prisma` and add one forward migration under `packages/db/prisma/migrations/<timestamp>_initiative_readiness_receipts/`:

- add closed `InitiativeGateKey` and nullable `BacklogItemActivity.gateKey`;
- add `(backlogItemId, gateKey, recordedAt DESC, id DESC)` index;
- add `InitiativeArtifactRetentionPin` with unique baseline activity, typed source kind, digest/locator, restrictive BuildArtifactRevision/DocumentVersion/DocumentBlob FKs, and indexes;
- add SQL check constraint for exactly one artifact branch and exact blob-backed version shape;
- add conditional BacklogItem deletion trigger for the four governance activity kinds;
- add append-only trigger for retention pins;
- preserve ordinary activity-only backlog deletion and existing rows.

Update generated database types only through the repo's canonical generation commands. Do not modify an existing migration.

### 3.3 Pure policy and adapters

Create a cohesive backlog/process-policy module, expected under `apps/web/lib/backlog/initiative-readiness/`:

- `types.ts` — targets, profiles, facts, requirements, verdicts, stable codes;
- `evaluate.ts` — deterministic evaluator with no DB imports;
- `profiles.ts` — change-class/work-type/archetype matrices and monotonic lattice;
- `receipt-schema.ts` — versioned activity payload validators;
- `receipt-reader.ts` — exact latest-gate batch query and focused detail load;
- `artifact-resolver.ts` — canonical BuildArtifactRevision/DocumentVersion/provider blob identity, digest, author, and subject resolution;
- `baseline-manifest.ts` — marker parser, anchor/digest generator, semantic diff;
- `baseline-repository.ts` — receipt-anchor row lock, exact-head CAS, baseline and permanent pin transaction;
- `projection.ts` — sanitized lifecycle projections and accountable next actions.

Upgrade the existing plan/decomposition substrate in the same FND slice:

- `apps/web/lib/planning/plan-backlog-coverage.ts` owns the version 1 reader plus version 2 validator/projection;
- `apps/web/lib/planning/plan-backlog-coverage.test.ts` owns v1 compatibility, v2 traceability, stale digest, and cycle tests;
- `apps/web/lib/mcp/packs/decomposition-pack.ts` and its tests accept/write/revalidate the immutable plan artifact locator/digest and v2 deliverable refs;
- the new readiness evaluator consumes this canonical projection rather than reparsing plan prose or creating another graph.

Prefer smaller modules with explicit inputs over one policy god-file. Export the shared contract through one index; surface adapters import that boundary only.

### 3.4 Governed writers and audit

Extend the existing MCP pack/agent-grant substrate:

- add thin reviewer-class tool definitions with one exact grant/capability each;
- keep authorization intersection single-source in `apps/web/lib/tak/agent-grants.ts` and the canonical agent registry/seed;
- persist allowlisted `authoritySnapshot` and exact receipt ID;
- store objective mappings as `initiative_objective_mapping` proposals;
- store work intent in `WorkCapsuleActivity`, never `WorkCapsule.activityKind`;
- add source invariants against updating/deleting governance activities or pins.

Implement the review-finding lifecycle in the same shared receipt handler: stable IDs derive from artifact revision + lane + normalized issue hash; Build Studio review findings normalize into that contract; a current-digest pass rejects unresolved critical/important refs; resolution appends a receipt naming the resolved refs and never edits/deletes the original finding.

### 3.5 FND verification and handoff

Run affected Vitest files, Prisma validation/generation, migration apply against representative existing-data fixtures, `pnpm --filter web build`, documentation-impact checks, independent semantic review, and exact-tree local merged-code CI. PR #4348 is the immutable delivery record for this pre-recovery slice. ENTRY and TERM may start only after the stable FND commit/PR contract is available.

## 4. Slice ENTRY — BI-4D756545

### 4.1 Red tests: every ingress and phase door

Add/extend tests around:

- `apps/web/lib/backlog/recommend.test.ts` and backlog MCP projection tests;
- `apps/web/lib/backlog/spec-plan-search.test.ts` for strict `hasSpec`/`hasPlan` separation;
- `apps/web/lib/mcp-tools-backlog.test.ts` for triage/recommendation behavior;
- `apps/web/lib/mcp-tools-work-capsules.test.ts` and WorkCapsule claim/adoption tests;
- `apps/web/lib/actions/build-governed.test.ts`;
- `apps/web/lib/mcp/build-lifecycle-handlers.test.ts` and phase-transition helpers.

Prove red for plan-only `hasSpec`, underspecified implementation recommendation, implementation claim before readiness, capsule mismatch, legacy generic review approval, and each Build Studio phase bypass.

### 4.2 Read and recommendation adapters

- extend `get_backlog_item` and list projections with design/plan/implementation/completion readiness;
- make `hasSpec` require a canonical spec artifact and keep `hasPlan` separate;
- add explicit design-candidate versus implementation-ready recommendation modes;
- preserve capture/triage while returning honest provisional classification and next action.

### 4.3 WorkCapsule claim adapter

- require `workIntent` for governed claims; treat legacy omission as implementation;
- evaluate the corresponding lifecycle target before claim success;
- append intent atomically and read back exact capsule, subject, intent, branch, worktree, executor, lease, and non-abandoned state;
- integrate the separately delivered pre-mutation guard; PR #4451 now records that equivalent implementation and regression.

### 4.4 Build Studio adapters

- keep promotion to `ideate` as design work with `Design needed` language;
- route `ideate → plan`, `plan → build`, ship, and complete doors through the shared evaluator;
- treat existing designReview/planReview JSON as advisory unless the governed receipt exists for the current revision;
- inventory main action, MCP handler, helper, queue, and completion paths with a source invariant.

### 4.5 ENTRY verification

Run focused tests and `pnpm --filter web build`; exercise design promotion and denied/allowed build transition in the canonical nonproduction environment once a lease is acquired; record docs impact, semantic review, and exact-tree CI evidence on BI-4D756545.

## 5. Slice TERM — BI-B770A083

### 5.1 Red tests: terminal bypasses and races

Add characterization/regression tests for current terminal writers in:

- `apps/web/lib/actions/backlog.ts` and REST backlog routes;
- Epic reconciliation/auto-close paths;
- FeatureBuild phase/release/complete actions and MCP handlers;
- WorkCapsule status tools/repositories.

Prove that code/tests/build evidence alone can currently allow terminal state, then require objective baseline, applicable gates, dependencies, authority, exact graph, and live acceptance evidence. Add CAS/serialization races and audit-write failure tests.

### 5.2 Canonical terminal-transition repository

Create one repository in the shared process-policy domain that:

1. resolves semantic subject and exact transition object;
2. verifies organization/user/principal, Epic origin, build origin, active capsule, semantic task ID, and executor/session binding;
3. gathers live facts and resolves caller mapping proposals;
4. derives authoritative objective reconciliation against the current baseline;
5. evaluates readiness and authority;
6. writes AuthorizationDecisionLog, minimized authority snapshot, and `initiative_readiness_decision`;
7. compare-and-set mutates the terminal row in one serializable transaction;
8. returns stable denial/recovery output.

Use the existing durable queue/outbox only after the local allowed state commits. Never treat an external dispatch as proof of local mutation.

Add the governed Epic receipt-anchor convergence operation before terminal evaluation. It resolves/creates the canonical originating BI, performs epic/backlog overlap checks, locks the Epic and anchor, refuses a conflicting non-null `originatingBacklogItemId`, appends an anchor-change activity, and only then permits receipt/baseline lookup. The veterinary legacy fixture must prove an unanchored Epic becomes input-required, can be linked accountably, and cannot have a conflicting anchor silently overwritten.

### 5.3 Migrate terminal writers

Route every BacklogItem done, Epic complete/auto-close, FeatureBuild terminal/ship, and governed WorkCapsule complete writer through the repository. Add a source invariant that enumerates the sanctioned boundary and rejects direct terminal writes elsewhere.

### 5.4 TERM verification

Run focused tests, build, representative migration/read checks, and canonical-runtime happy/denied paths for backlog, Epic, Build Studio, and WorkCapsule completion. Record semantic review and exact-tree CI evidence on BI-B770A083.

## 6. Slice TASK — BI-441BECAC

### 6.1 Inventory and characterization

Use `rg` plus code-graph evidence to enumerate every production `TaskRun` success write, including remote MCP submit, child-thread dispatch, scheduled tasks, brand extraction, deliberation, pattern observation/experiments, Build Studio execution, and queue functions. Record the inventory in a source invariant fixture so later writers cannot drift in silently.

Write red characterization tests showing governed remote/child success becomes completed today without baseline reconciliation while an ordinary conversational run still completes normally.

### 6.2 `completeTaskRun` boundary

Add one domain boundary that:

- resolves governance through active WorkCapsule, FeatureBuild origin, or explicit governed-subject envelope;
- defines WorkCapsule.taskRunId as semantic `TaskRun.taskRunId`, never row ID;
- maps scoped execution objectives to current baseline IDs;
- joins ToolExecution evidence through `taskRunId`;
- calls the TERM repository for governed terminal success;
- writes canonical stored `input-required` and MCP wire `input_required` when subject or objective evidence is unresolved;
- preserves current ungoverned conversational behavior.

Migrate every inventoried writer and prohibit direct success updates outside this boundary.

### 6.3 TASK verification

Run every migrated writer's focused tests, invariant, web build, and canonical-runtime governed/ungoverned TaskRun paths. Record semantic review and exact-tree CI evidence on BI-441BECAC.

## 7. Slice UX — BI-812AC0D8

### 7.1 Presenter and route tests first

Add pure presenter/component tests for provisional, ready, failed review, stale/malformed evidence, permission loss, restricted details, projection failure, legacy-unverified, and selected-item states. Assert:

- one plain lifecycle state and one enabled primary recovery action;
- no new route/tab/dashboard/status narrator;
- implementation actions disappear when unavailable;
- view/disclosure dispatches zero prompts/tools;
- one dispatch occurs only after explicit preview/confirmation;
- text/icon supplements color and restricted evidence is not mislabeled missing.

### 7.2 Existing component convergence

Extend existing components only:

- `BacklogItemRow` and existing `/ops` details/action seams;
- `BuildStudioWorkflowActionCard`, `ActionBanner`, `ReviewReadinessStrip`, `UnifiedEvidenceTimeline`, and `DetailsDrawer` under `/build`;
- `WorkControlPanel` and existing `/build/work` action/status region;
- shared report-kit/status primitives for consistent language.

List views consume bounded sanitized projections. Focused detail loads restricted evidence only after authorization. Drawers restore focus; reevaluation uses a live region; actions meet 44px minimum; narrow viewport keeps the primary recovery action visible.

### 7.3 Per-adapter rollout

Persist/record an activation record for ENTRY, TERM, TASK, and UI consumers with owner, policy version, observation start, sample size, error/false-denial rate, SLO threshold, deadline, rollback rule, state, and enforcement time. Observation mode may never label work ready. Parent completion requires every required adapter enforced and every direct-writer invariant green.

### 7.4 Documentation and UX verification

Update MCP schemas/examples, backlog semantics, Build Studio lifecycle, TaskRun completion, contributor/external-agent procedure, archetype paved road, route help, and architecture cross-links without duplicating doctrine.

Acquire the governed nonproduction lease and run served-DOM verification on `/ops`, `/build`, and `/build/work` at desktop and narrow viewports. Run axe, light/dark/org themes, hardcoded-color/style-drift scans, route-budget ratchets, zero-dispatch assertions, and an exact-scope `docs/ux-fit/` sweep manifest.

Record semantic review, exact-tree local CI, and canonical runtime evidence on BI-812AC0D8.

## 8. Parent reconciliation and release order

1. Merge FND through a ready PR and merge queue.
2. Refresh ENTRY and TERM on the merged FND contract; they may proceed independently if their overlap sweep is clean.
3. Merge TERM, then refresh and merge TASK.
4. Refresh UX on all merged adapters and complete rollout/verification.
5. Re-read PR #4451's pre-mutation Workroom claim regression evidence. If the equivalent guard is no longer merged/current, keep BI-CF5A1078 and the external goal in progress.
6. Revalidate the plan coverage receipt and each child BI live state.
7. Run the parent gate/evidence matrix. Do not infer satisfaction from child prose; use live receipt IDs, PR/merge SHAs, CI, runtime, UX, migration, docs, and independent review evidence.
8. Only then request the governed parent completion transition and reconcile the external goal.

## 9. Exact 20% refactoring budget

Reserve one in every five implementation task points for touched-seam cleanup. The planned allocation is:

| Refactor | Owning slice | Budget share |
|---|---|---:|
| Extract pure evaluator/types/profiles from database/rendering concerns | FND | 5% |
| Consolidate artifact/subject resolution and latest-receipt reads | FND | 4% |
| Remove `hasSpec`/`hasPlan` conflation and local readiness helpers | ENTRY | 3% |
| Centralize terminal mutation/authority/audit/CAS logic | TERM | 4% |
| Centralize TaskRun success writes and semantic-ID handling | TASK | 3% |
| Consolidate readiness presentation copy/status mapping | UX | 1% |
| **Total** |  | **20%** |

Each refactor begins with characterization tests and stays inside a touched seam. Unrelated cleanup, schema redesign, or restyling is excluded.

## 10. Gate and evidence matrix

Every child records its own exact evidence. The parent matrix is complete only when all applicable cells are live and current:

| Gate | FND | ENTRY | TERM | TASK | UX | Parent condition |
|---|---|---|---|---|---|---|
| Approved design/reviews | inherited exact design commit | inherited | inherited | inherited | inherited + UX implementation review | immutable review receipt remains current |
| Plan coverage | mapped BI | mapped BI | mapped BI | mapped BI | mapped BI | receipt revalidates all five live items |
| Unit/integration tests | required | required | required | required | required | all green on merged exact trees |
| Production build | required | required | required | required | required | zero errors |
| Migration | apply/compatibility | N/A | representative read | N/A | N/A | FND migration merged and live verified |
| UX/runtime | technical read projection | claim/Build path | terminal paths | TaskRun paths | full served-DOM sweep | canonical nonproduction evidence current |
| Security/compliance | receipt/auth/retention abuse suite | bypass/identity | authority/CAS | subject/evidence binding | restricted disclosure | no open blocking finding |
| Documentation | schema/contracts | entry semantics | completion semantics | TaskRun semantics | user/agent/route docs | docs impact complete |
| Semantic review | required | required | required | required | required | stable committed tree receipts |
| Local merged-code CI | required | required | required | required | required | exact-tree receipts, no red push |
| PR/DCO/merge | ready PR | ready PR | ready PR | ready PR | ready PR | all merged via queue |
| Separate capsule defect | — | consumes merged contract | — | — | documents condition | PR #4451 equivalent remains merged with regression evidence |

## 11. Rollback and compatibility

- Existing completed initiatives are not reopened; they display legacy-unverified status.
- Existing provisional work remains visible and designable.
- Legacy work-intent omission is treated as implementation for governed claims.
- Each adapter activates independently and can roll back to observation while never claiming readiness.
- Schema rollback is a normal code revert plus forward corrective migration; migrations are never edited or rolled back in place.
- Retention pins are permanent evidence. Rollback cannot delete pins or approved artifacts; a future disposition needs its own governed design.

## 12. Plan review and backlog coverage

### Backlog coverage

- **Decision:** `decomposed`
- **Superseded bootstrap receipt:** `cmskz2b8805tq01o1v6dyzvvc` (its placeholder BIs no longer resolve after PostgreSQL recovery)
- **Current receipt:** must be recorded and revalidated against the immutable merged reconciliation commit before TASK implementation
- **Exact graph:** FND → ENTRY; FND → TERM; FND + TERM → TASK; ENTRY + TERM + TASK → UX
- **Mapped live items:** ENTRY `BI-4D756545`; TERM `BI-B770A083`; TASK `BI-441BECAC`; UX `BI-812AC0D8`. FND is an already-delivered prerequisite recorded by PR #4348, not an invented replacement BI.

The superseded receipt was the bootstrap gate for FND before PostgreSQL recovery. FND later delivered the version 2 contract in PR #4348. Record and revalidate a new version 2 receipt bound to the immutable reconciliation commit, with requirement/contract/flow/verification refs and the live acyclic dependency graph, before TASK or UX source implementation continues. The historical version 1 receipt remains visible but cannot satisfy governed implementation transitions.

Before source implementation:

- an independent plan reviewer must confirm design traceability, exact adapter inventory, TDD ordering, migration/retention safety, UX verification, documentation impact, child dependencies, and 20% refactor allocation;
- the new decomposed receipt must remain current and every mapped live BI must resolve;
- the current immutable-plan v2 receipt must replace the bootstrap gate for all remaining slices;
- the final reviewed plan commit and review/coverage receipt IDs must be recorded on BI-CF5A1078.

### Independent plan-review disposition

The independent reviewer initially failed the plan on six findings and approved it after these resolutions:

- `IPLAN-001`: FND now owns plan-coverage v2, immutable artifact identity, four-way traceability refs, legacy-v1 projection, cycle/dependency tests, and decomposition-tool changes.
- `IPLAN-002`: the historical decomposed receipt `cmskz2b8805tq01o1v6dyzvvc` mapped the original five-slice graph; this reconciliation requires a fresh v2 receipt for the live four-BI graph plus the delivered FND prerequisite.
- `IPLAN-003`: §2.1 enumerates verified BacklogItem, Epic, FeatureBuild, WorkCapsule, direct/indirect TaskRun update, already-completed TaskRun creation, and parent experiment transition paths before implementation.
- `IPLAN-004`: TERM owns governed Epic originating-BI convergence, overlap checks, conflict denial, and veterinary legacy regression.
- `IPLAN-005`: FND owns application/database deletion compatibility, permanent authority/hold retention, append-only, and specialist N/A abuse tests.
- `IPLAN-006`: FND owns stable finding identity, current-digest binding, blocker/pass exclusion, append-only resolution, and Build Studio normalization.

Final verdict: **PASS — approved for implementation under the TDD, review, gate, rollout, and reconciliation conditions in this plan.** Any content change requires rereview.
