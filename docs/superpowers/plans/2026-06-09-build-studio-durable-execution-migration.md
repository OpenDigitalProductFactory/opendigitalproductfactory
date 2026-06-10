# Build Studio durable-execution migration — implementation plan

**Backlog item:** `BI-89030C9B` — Move Build Studio orchestration onto Inngest durable execution (epic `EP-BUILD-STUDIO`)
**Grounding spec:** [`docs/architecture/2026-06-09-long-running-agentic-process-architecture.md`](../../architecture/2026-06-09-long-running-agentic-process-architecture.md) (merged via PR #1674) — especially §4 (the gap), §7.1 (the moves), §7.5 (Inngest constraints), §7.6 (versioning crux / open design question #1).
**Companion:** [`2026-06-09-dap-experience-layer-design.md`](../../architecture/2026-06-09-dap-experience-layer-design.md) — the experience-layer work is `BI-BC8F667E` and is *not* in this plan's scope except where the migration must not break existing UI surfaces.
**Process note:** Operator-directed to proceed outside the Build Studio pipeline (2026-06-09): Build Studio is itself the unreliable component under repair, so the standing "BS for all development" rule is suspended for this BI specifically. All changes still land via PR with DCO; nothing merges without operator review.

**Definition of done** (from the BI / spec §8 Phases 0–2): the build phase runs as an Inngest function with per-task `step.run`, artifacts returned by reference, behind a flag; resume-across-restart is proven **functionally on the live install**; the hand-rolled checkpoint/recovery retrofits are deleted; a build survives a self-upgrade swap.

---

## Substrate facts this plan is built on (verified in-tree, 2026-06-09)

| Fact | Where |
|---|---|
| Pipeline steps: `pending → sandbox_created → workspace_initialized → db_ready → deps_installed → code_generated → tests_run → complete` (+`failed`; `slot_queued` transient). Per-step `MAX_RETRIES`, `RETRY_DELAYS_MS` | [`apps/web/lib/integrate/build-exec-types.ts:34-75`](../../../apps/web/lib/integrate/build-exec-types.ts) |
| Hand-rolled checkpoint pipeline (`getResumeStep`, `runBuildPipeline`, `buildExecState` persisted per step) — exists in **two copies** | [`apps/web/lib/integrate/build-pipeline.ts`](../../../apps/web/lib/integrate/build-pipeline.ts), `apps/web/lib/build-pipeline.ts` |
| Entry is fire-and-forget: `autoExecuteBuild()` defined `build.ts:735`, called at `:710/:876/:908/:1149` | [`apps/web/lib/actions/build.ts`](../../../apps/web/lib/actions/build.ts) |
| 14-task specialist orchestration runs inside the `code_generated` step: `runBuildOrchestrator()` (:951), `dispatchSpecialist()` (:746), title-match resume `getCompletedTaskTitles()` (:712), `MAX_MERGE_RETRIES = 1` silent-drop (:1352) | [`apps/web/lib/integrate/build-orchestrator.ts`](../../../apps/web/lib/integrate/build-orchestrator.ts) |
| Boot-time recovery hooks to delete: self-upgrade reconcile (:119), contradictory-state (:214), stranded-build (:305) | [`apps/web/instrumentation.ts`](../../../apps/web/instrumentation.ts) |
| Inngest function idiom to copy: `inngest.createFunction({id, retries, concurrency, triggers}, …)` + quiescence `gateAtEntry(step)` + lazy-import `step.run`s | [`apps/web/lib/queue/functions/eval-background.ts`](../../../apps/web/lib/queue/functions/eval-background.ts) |
| Registration: append to `eventFunctions` (always served; scheduled fns are flag-gated separately) | [`apps/web/lib/queue/functions/index.ts:74-113`](../../../apps/web/lib/queue/functions/index.ts) |
| `build/*` event namespace already exists in the typed event map | [`apps/web/lib/queue/inngest-client.ts:110`](../../../apps/web/lib/queue/inngest-client.ts) |
| **Precedent: Build Studio already has one Inngest function** — `buildReviewVerification` | [`apps/web/lib/queue/functions/build-review-verification.ts`](../../../apps/web/lib/queue/functions/build-review-verification.ts) |
| Env-flag idiom: `envFlagEnabled(env, "DPF_…")` | [`apps/web/lib/runtime/env-flags.ts`](../../../apps/web/lib/runtime/env-flags.ts) |
| Inngest is out-of-process (own container + Postgres + Redis), portal is a stateless function-server to it | [`docker-compose.yml:666`](../../../docker-compose.yml), spec §3.1 |
| Builds do not own a `TaskRun` today; `taskRunId` only optionally threaded for deliberation | spec §7.4 caveat, `build-orchestrator.ts:415` |

Hard engine limits the design respects (spec §7.5, confirmed against Inngest docs): 4MB/step output, **32MB run-state total** (the binding one), 1000 steps/function, ≤2h/step, replay determinism, step-id memoization.

---

## Phase 0 — Spike: answer the two empirical unknowns (no product code)

The two facts the whole design branches on, per spec §7.5/§7.6. Throwaway code only; findings appended to this plan as a dated addendum.

1. **Does portal death kill an in-flight sandbox CLI run?** Today the CLI runs inside the sandbox container but is driven by a portal-held exec stream. Start a contained specialist dispatch, `docker restart` the portal mid-run, then check whether the CLI process is still alive inside the sandbox container and whether its output is recoverable.
   - *If it dies with the portal* → Phase 2 must build the detached-job pattern (dispatch step returns a job id; completion observed by poll/event).
   - *If it survives* → Phase 2 only needs re-attach (re-read output by job id).
2. **Journal-resume behavior on our pinned self-hosted Inngest.** A spike function with three slow steps; kill the portal mid-step-2; confirm Inngest re-invokes against the restarted portal, step 1 returns memoized, step 2 re-runs. Also confirm the pinned image's actual limits match the documented 4MB/32MB/1000-step numbers.

**Verification:** a written addendum with logs for both answers. Nothing ships.

## Phase 1 — Durable pipeline skeleton, behind a flag (first independently shippable slice)

Wrap the *existing* pipeline steps as journaled Inngest steps. No orchestrator-internals change yet — `code_generated` remains one (long) step in this phase; that is acceptable short-term because the orchestrator's own title-match resume still functions inside it, and Phase 2 fixes the granularity.

**Deliverables / files:**
- `build/execute.run` event added to the typed event map ([`inngest-client.ts`](../../../apps/web/lib/queue/inngest-client.ts), `build/*` namespace) with `{ buildId, taskRunId }` payload.
- New `apps/web/lib/queue/functions/build-execute.ts`: `id: "build/execute"`, `concurrency: [{ limit: 1 }]` (parity with today's single-build admission), fn-level `retries: 0` (retry budget lives per-step, ported from `MAX_RETRIES`), one `step.run(stepId, …)` per `STEP_ORDER` entry, each lazy-importing the *existing* step implementation from `build-pipeline.ts`. Step ids are the stable step names (`sandbox_created`, `db_ready`, …) — content-independent, satisfying the memoization constraint.
- **Artifacts by reference from day one:** each step writes its outputs where they already go (`FeatureBuild` row / `buildExecState` dual-write for UI compatibility) *inside* the step and returns only `{ ok, ref }`-shaped pointers, keeping run-state far below the 32MB cap.
- **Quiescence semantics decided deliberately:** unlike `eval-background`, a build must *defer, not skip* at `gateAtEntry` — if quiescence is draining, the function sleeps/retries rather than returning `{skipped}` and silently dropping a build.
- `autoExecuteBuild()` ([`build.ts:735`](../../../apps/web/lib/actions/build.ts)) branches on `DPF_BUILD_DURABLE_EXECUTION_ENABLED` (via `envFlagEnabled`): flag on → `inngest.send("build/execute.run")`; flag off → legacy in-process path, byte-for-byte unchanged. All four call sites untouched.
- **Per-build `TaskRun` stood up** (`source: "build"`, 1:1 link to `FeatureBuild`), heartbeat marked from the running function so the existing `taskrun-watchdog` covers builds — closes the spec §7.4 identity caveat.

**Verification (functional, live install — `structural-verification-is-not-functional`):**
- Flag on, contained build: `docker restart` the portal during `deps_installed`; the build resumes at the next step with **no boot-hook involvement** (hooks observed as no-ops in logs).
- Completed-step memoization observed in Inngest run trace.
- Flag off: a full build runs the legacy path identically (regression guard).
- UI: operational panel / process graph render unchanged (dual-written `buildExecState` is still their truth source in this phase).

## Phase 2 — Per-task durability inside `code_generated` + decouple long CLI dispatch

The granularity fix — recovery unit becomes one specialist task, not the whole orchestrator run.

**Deliverables / files:**
- **Immutable `taskId`** added to `BuildPlanDoc` tasks at plan-generation time ([`feature-build-types.ts`](../../../apps/web/lib/explore/feature-build-types.ts) + the plan-producing prompt/parser); orchestrator keys everything by `taskId`, never title.
- `runBuildOrchestrator` runs *inside* the Inngest function; each `dispatchSpecialist` becomes `step.run("task:" + taskId, …)`. Dependency-graph computation happens once inside its own step (journaled), so replay is deterministic — this is the §7.5 determinism-audit work item, scoped to the orchestrator's control flow.
- **`taskResults` write becomes its own idempotent step** keyed by `taskId` — single-writer through the journal, deleting the `MAX_MERGE_RETRIES = 1` silent-drop class (optimistic lock retained as a belt-and-braces guard).
- **Long-dispatch decoupling, shaped by the Phase-0 finding:** a short `step.run` *starts* the sandbox CLI job detached and returns its job id; the workflow then observes completion via `step.waitForEvent` (completion event emitted by a sandbox-side hook) or a bounded `step.run`-check + `step.sleep` poll loop. A portal recycle mid-task then re-attaches to the still-running job instead of restarting 40 minutes of CLI work. Per-task timeout + iteration/spend caps land here (spec principle 8).
- Concurrency parity: today's `MAX_CONCURRENT_TASKS = 2` preserved by batching task steps two-at-a-time within the function.

**Verification (functional):**
- Kill the portal mid-specialist-task: only that task re-attaches (or re-runs, bounded), all prior tasks return memoized from the journal; total re-done work ≤ one task.
- Re-plan with renamed task titles mid-build: no duplicate or skipped tasks (taskId identity holds).
- Synthetic oversized step output rejected by a guard test (32MB protection).

## Phase 3 — Retire the retrofits + `$/build` instrumentation

Only after a burn-in of ≥5 consecutive green flagged builds, including at least one with a forced mid-build restart.

**Deliverables / files:**
- **Delete:** title-match resume (`getCompletedTaskTitles`, orchestrator resume-by-title block); stranded-build and contradictory-state boot hooks ([`instrumentation.ts:214,:305`](../../../apps/web/instrumentation.ts)); the hand-rolled checkpoint engine in **both** `build-pipeline.ts` copies (`getResumeStep`/`MAX_RETRIES`/`RETRY_DELAYS_MS` consumed into per-step retry config); the contradictory-state classifiers in `build-exec-types.ts` once nothing references them. `buildExecState` remains only as a UI projection written by the steps (the journal is the recovery truth).
- Legacy in-process path removed from `autoExecuteBuild`; the flag flips to default-on and then retires.
- **`$/build` accounting** (Decision B prerequisite, spec §9.6.2): per-task `inputTokens`/`outputTokens`/`costUsd`/model-id persisted (agentic path totals exist already; CLI path records duration + model + provider, tokens where the CLI reports them) onto the per-build `TaskRun.progressPayload` and surfaced per phase.
- Update [`dpf-patterns.md`](../../architecture/dpf-patterns.md) with the named **Durable Agentic Process** pattern entry (spec §8 Phase 3).

**Verification:** greps for the deleted symbols return zero; boot logs show no recovery-hook activity across 3 restarts; repeat the Phase-1 kill test with hooks gone; a live build shows populated cost fields per task.

## Phase 4 — Self-upgrade safety (resolves spec open design question #1)

**Approach decision** (to be run through `principle_decide` with the operator per `dpf-decision-via-kernel` before implementation): recommended option is **(a) quiescence-drain + Phase-2 re-attach** — the upgrade drains *new* build admissions, in-flight CLI jobs keep running in their sandbox containers through the portal swap, and the post-swap function re-attaches via the Phase-2 wait/poll pattern. This likely makes side-by-side function versioning (option b) unnecessary; (b) stays documented as the fallback if drains prove too costly for multi-hour builds.

**Verification (functional):** a build with a specialist task in flight *at swap time* survives a real self-upgrade end-to-end; the self-upgrade-kills-in-session bug class is closed with evidence.

---

## Risks, blast radius, rollback

| Risk | Mitigation / rollback |
|---|---|
| Durable path regresses builds | Flag-gated dual path through Phases 1–2; **rollback = flag off**, legacy path untouched until Phase 3's burn-in gate |
| Replay non-determinism in orchestrator control flow | Phase-2 audit confines all mutable reads to journaled steps; spike (Phase 0) validates engine behavior first |
| 32MB run-state breach on big builds | By-reference convention from Phase 1 + guard test in Phase 2 |
| Quiescence gate silently skipping builds | Defer-not-skip semantics decided in Phase 1, tested with a drain in progress |
| Shared-engine contention (builds + marketing + deliberation on one Inngest) | Build fn `concurrency: 1`; engine HA/backup discipline tracked separately (spec §7.6 — needs its own BI before month-close ever lands on the engine) |
| In-flight CLI orphaned by portal death (unknown until spike) | Phase 0 answers it; Phase 2 builds detached-job or re-attach accordingly |
| Blast radius generally | Builds only. Marketing, deliberation, discovery, backups, and all other Inngest functions untouched; flag-off restores status quo ante at any point before Phase 3 |

## Sequencing & ownership

Phases are strictly ordered (0 → 1 → 2 → 3 → 4); Phase 1 is the first shippable PR. Each phase is one PR (Phase 3 possibly two: deletions vs. cost instrumentation). Operator reviews every PR; functional verification evidence (the kill tests) is attached to the PR description per `structural-verification-is-not-functional`. The experience-layer BI (`BI-BC8F667E`) consumes the journal as truth source starting Phase 3 but is planned separately.
