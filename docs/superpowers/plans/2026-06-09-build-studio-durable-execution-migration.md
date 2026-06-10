# Build Studio durable-execution migration — implementation plan

**Backlog item:** `BI-89030C9B` — Move Build Studio orchestration onto Inngest durable execution (epic `EP-BUILD-STUDIO`)
**Grounding spec:** [`docs/architecture/2026-06-09-long-running-agentic-process-architecture.md`](../../architecture/2026-06-09-long-running-agentic-process-architecture.md) (merged via PR #1674) — especially §4 (the gap), §7.1 (the moves), §7.5 (Inngest constraints), §7.6 (versioning crux / open design question #1).
**Companion:** [`2026-06-09-dap-experience-layer-design.md`](../../architecture/2026-06-09-dap-experience-layer-design.md) — the experience-layer redesign is `BI-BC8F667E` and is *not* in this plan's scope. But this migration is **not UX-neutral**: it moves the operator's truth source (`buildExecState` → journal) and removes recovery machinery that operator-facing affordances are wired to. See **Operator-experience guardrails** below for the specific surfaces this touches and their acceptance criteria — that is the concrete meaning of "must not break existing UI surfaces."
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
| **Today's admission is NOT single-build.** Three independent gates: (1) **`BUILD_WIP_CAP = 3`** concurrent builds via `assertWipCapacity()`; (2) a **sandbox slot pool** (`waitForSandboxSlot`, waits ≤30 min, emits `slot_queued`); (3) intra-build `MAX_CONCURRENT_TASKS = 2`. The Inngest concurrency design must preserve all three — see Phase 1. | [`apps/web/lib/build/wip-cap.ts:30`](../../../apps/web/lib/build/wip-cap.ts), `build-pipeline.ts:264`, `build-orchestrator.ts:1221` |

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

> **Phase-1 constraint — the monolithic `code_generated` step can hit the 2h/step ceiling.** Keeping the full 14-specialist orchestrator inside one `step.run` means that single step is subject to Inngest's **≤2h step limit**. A large build whose generation phase exceeds 2h would have that step killed by the engine — a *new* failure mode this phase introduces and Phase 2 removes (per-task steps each well under 2h). Mitigation for Phase 1: gate the flag to builds whose `code_generated` is expected < 2h (the contained builds used for verification already satisfy this), and treat "build exceeds 2h in generation" as a known Phase-1 limitation, not a regression to debug. Confirm the pinned image's real step ceiling in the Phase-0 spike.

**Deliverables / files:**
- `build/execute.run` event added to the typed event map ([`inngest-client.ts`](../../../apps/web/lib/queue/inngest-client.ts), `build/*` namespace) with `{ buildId, taskRunId }` payload.
- New `apps/web/lib/queue/functions/build-execute.ts`: `id: "build/execute"`, fn-level `retries: 0` (retry budget lives per-step, ported from `MAX_RETRIES`), one `step.run(stepId, …)` per `STEP_ORDER` entry, each lazy-importing the *existing* step implementation from `build-pipeline.ts`. Step ids are the stable step names (`sandbox_created`, `db_ready`, …) — content-independent, satisfying the memoization constraint.
  - **Concurrency — get this right, it is not `limit: 1`.** Today three gates run concurrently up to `BUILD_WIP_CAP = 3` (verified above). Map them deliberately, not to a single global limit: **(a)** one run *per build* via `concurrency: [{ key: "event.data.buildId", limit: 1 }]` (prevents two runs of the *same* build); **(b)** the global cap of 3 via a second `concurrency: [{ limit: 3 }]` scope **or** by keeping the existing `assertWipCapacity()` DB check at the send site — pick one source of truth, don't double-enforce; **(c)** the sandbox slot pool stays as-is (the `sandbox_created` step still calls `waitForSandboxSlot`). A flat `concurrency: 1` would serialize all builds — a 3× throughput regression vs. today.
- **Artifacts by reference from day one:** each step writes its outputs where they already go (`FeatureBuild` row / `buildExecState` dual-write for UI compatibility) *inside* the step and returns only `{ ok, ref }`-shaped pointers, keeping run-state far below the 32MB cap.
- **Quiescence semantics decided deliberately:** unlike `eval-background`, a build must *defer, not skip* at `gateAtEntry` — if quiescence is draining, the function sleeps/retries rather than returning `{skipped}` and silently dropping a build.
- `autoExecuteBuild()` ([`build.ts:735`](../../../apps/web/lib/actions/build.ts)) branches on `DPF_BUILD_DURABLE_EXECUTION_ENABLED` (via `envFlagEnabled`): flag on → `inngest.send("build/execute.run")`; flag off → legacy in-process path, byte-for-byte unchanged. All four call sites untouched. **The send must carry an event idempotency `id` keyed on `buildId`** (e.g. `build-execute:${buildId}:${attemptEpoch}`) — `autoExecuteBuild` is invoked from four sites and is itself retry-prone, and without dedup two sends would spawn two durable runs of the same build. This is the send-side complement to the per-build `concurrency` key above.
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
  - **The *start* step must itself be idempotent — this is the new correctness hazard, not the result write.** `dispatchSpecialist()` today just emits + launches with no "already running?" guard ([`build-orchestrator.ts:746`](../../../apps/web/lib/integrate/build-orchestrator.ts)). Inngest retries a step whose HTTP invocation failed *after* the side effect ran — so a naive start step that launches the CLI and then loses its return would, on retry, **launch a second specialist for the same `taskId`**. The start step must be keyed by `taskId` and check-then-attach: "is a job already running/finished for this taskId? → return its id; else launch." This is the dispatch-side analogue of the idempotent `taskResults` write above.
  - **Prefer the poll loop over `waitForEvent` as the default.** The completion-event path needs the *sandbox* container to reach Inngest's event endpoint (`INNGEST_EVENT_KEY`), a new network dependency and a new failure surface; a `step.run` poll of job state is portal-only and strictly simpler. Whichever is used, the wait needs an explicit timeout whose expiry routes to the **`StallEvent` watchdog** (→ `stale`, then retry/abandon/escalate), so a job that never signals completion fails loud, not silent — closing the loop with spec §7.5's "HITL/long-wait needs a bounded path."
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
- **`$/build` accounting** (Decision B prerequisite, spec §9.6 item 2): per-task `inputTokens`/`outputTokens`/`costUsd`/model-id persisted onto the per-build `TaskRun.progressPayload` and surfaced per phase. **Key correction — the CLI cost data already exists and is being thrown away, so this is cheaper than the spec implies.** The Claude dispatch already runs `claude … --output-format json` and parses the envelope, but keeps only `result` ([`claude-dispatch.ts:248,315`](../../../apps/web/lib/integrate/claude-dispatch.ts)); that same envelope carries `total_cost_usd` and `usage` (input/output tokens). So Phase 3 is mostly "stop discarding the usage/cost fields the CLI already returns," not "find a way to measure the unmeasurable." (Confirm the Codex envelope separately — it may not emit usage in the same shape.) This also matters *more* now than when the spec was written: post-2026-06-15 (spec §9.3) headless Claude Code bills per-token against a metered credit pool, so a build genuinely costs money per token and `$/build` is real spend, not a subscription rounding error. Consider landing a minimal duration+model+cost capture as early as Phase 1 (the `TaskRun` is stood up there), with full per-token rollup in Phase 3 — measuring from the start, per the spec's intent.
- Update [`dpf-patterns.md`](../../architecture/dpf-patterns.md) with the named **Durable Agentic Process** pattern entry (spec §8 Phase 3).

**Verification:** greps for the deleted symbols return zero; boot logs show no recovery-hook activity across 3 restarts; repeat the Phase-1 kill test with hooks gone; a live build shows populated cost fields per task.

## Phase 4 — Self-upgrade safety (resolves spec open design question #1)

**Approach decision** (to be run through `principle_decide` with the operator per `dpf-decision-via-kernel` before implementation): recommended option is **(a) quiescence-drain + Phase-2 re-attach** — the upgrade drains *new* build admissions, in-flight CLI jobs keep running in their sandbox containers through the portal swap, and the post-swap function re-attaches via the Phase-2 wait/poll pattern. This likely makes side-by-side function versioning (option b) unnecessary; (b) stays documented as the fallback if drains prove too costly for multi-hour builds.

> **Dependency — option (a) is only viable if the CLI job is portal-independent.** "In-flight CLI jobs keep running through the swap" presupposes the **Phase-0 spike** found the CLI survives portal death, *or* the **Phase-2 detached-job pattern** was built to make it so. If Phase 0 found the CLI dies with the portal and the detached-job work slipped, option (a) silently degrades to "kill and re-run the in-flight task on resume" — acceptable (bounded re-work) but no longer the clean story above. Make the Phase-4 design contingent on the recorded Phase-0 finding, and fall to (b) only if drains of *detached* multi-hour jobs are themselves too costly.

**Verification (functional):** a build with a specialist task in flight *at swap time* survives a real self-upgrade end-to-end; the self-upgrade-kills-in-session bug class is closed with evidence.

---

## Risks, blast radius, rollback

| Risk | Mitigation / rollback |
|---|---|
| Durable path regresses builds | Flag-gated dual path through Phases 1–2; **rollback = flag off**, legacy path untouched until Phase 3's burn-in gate |
| Replay non-determinism in orchestrator control flow | Phase-2 audit confines all mutable reads to journaled steps; spike (Phase 0) validates engine behavior first |
| 32MB run-state breach on big builds | By-reference convention from Phase 1 + guard test in Phase 2 |
| Quiescence gate silently skipping builds | Defer-not-skip semantics decided in Phase 1, tested with a drain in progress |
| Shared-engine contention (builds + marketing + deliberation on one Inngest) | Build fn uses *scoped* concurrency — per-build key + global cap 3 (Phase 1), **not** a flat `limit: 1` (which would 3× regress throughput); engine HA/backup discipline tracked separately (spec §7.6 — needs its own BI before month-close ever lands on the engine) |
| In-flight CLI orphaned by portal death (unknown until spike) | Phase 0 answers it; Phase 2 builds detached-job or re-attach accordingly |
| Blast radius generally | Builds only. Marketing, deliberation, discovery, backups, and all other Inngest functions untouched; flag-off restores status quo ante at any point before Phase 3 |
| Latent durable bug surfaces *after* Phase 3 (legacy path deleted → no flag-off rollback) | Keep the flag **and** the legacy in-process path for **one full release cycle past the burn-in gate**, not just until the Phase-3 PR merges; only delete the legacy path once a tagged release has run durable-default in production without a recovery-hook firing. Until then, keep a pre-written revert PR ready. |
| Double durable run for one build (4 send sites × retries) | Per-build `concurrency` key (Phase 1) **and** event idempotency `id` on the send — both required, belt-and-braces |
| Phase-1 monolithic `code_generated` step exceeds 2h/step ceiling | Flag gated to <2h builds in Phase 1; Phase 2's per-task split removes the ceiling exposure entirely |
| Truth-source transition (`buildExecState` → journal) shows operator drift/conflict | Dual-write kept through Phase 2; `TruthSourceBadge` / `hasStaleTruthConflict` is the regression detector; Phase-3 cutover gated on zero introduced conflict (Operator-experience guardrails A1) |
| Recovery affordances orphaned when their backing state can no longer occur | Reset Build (`FB-78E967D4`) + Retry/Resume triggers audited and retired/repointed in Phase 3, not left dangling (A2) |
| A build silently completes / blocks while the operator is away | This migration makes unattended multi-hour builds normal; the "done / needs-you" delivery path is `BI-BC8F667E` — land its Phase 1–2 notification slice in lockstep (A5) |

## Operator-experience guardrails (the UX surfaces this migration touches)

The experience-layer redesign is `BI-BC8F667E` (separate). But this migration moves the operator's **truth source** and deletes **recovery machinery the UI is wired to**, so these are in-scope acceptance criteria for "must not break existing UI surfaces." Grounded in the companion (criteria 13–17) and a live 2026-06-09 quiescence observation.

**A1 — The truth-source transition is a UX risk, not a no-op (Phase 1→3).** The operational panel reads a multi-source projection ([`progress-visibility.ts`](../../../apps/web/lib/build/progress-visibility.ts)) and `TruthSourceBadge` flags disagreement between sources. Phases 1–2 keep `buildExecState` dual-written as the UI truth while the journal becomes the *recovery* truth; Phase 3 cuts the UI over to the journal. Acceptance: the dual-write introduces **no new truth-source conflict** (the badge is the detector), and the Phase-3 cutover never lets the panel show a step the journal didn't run. Companion criterion 14.

**A2 — Audit and retire the recovery affordances coupled to the deleted machinery (Phase 3).** "Reset Build" (`FB-78E967D4`, [`build-studio-workflow-actions.ts:91,:509`](../../../apps/web/components/build/build-studio-workflow-actions.ts)) surfaces *only* when `buildExecState` is in a self-contradictory shape — the exact state Phase 3 says "stops occurring." Retry/Resume likewise branch on `buildExecState.step`. Deleting the boot hooks without touching these leaves the operator a **recovery button for a state that can no longer happen**, and resume logic reading a projection whose meaning changed. Phase 3 must explicitly audit Reset Build + the Retry/Resume triggers and retire or repoint them onto the journal. Companion criterion 16 + the platform's "delete superseded artifacts in the same turn" discipline.

**A3 — A drain-deferred build is a new operator-visible state; make it legible (Phase 1 + Phase 4).** Phase 1's deliberate "defer-not-skip" at `gateAtEntry` is correct, but it produces a build *paused by a platform upgrade* — which must read as "paused, resumes after swap," not frozen. Not hypothetical: on **2026-06-09** the live quiescence drain surfaced "AI coworker working ×4 / recent portal-MCP activity" with no way to tell what was actually working or whether anything was stuck — the operator's first reaction was "that's odd, no one's on the portal." A deferred *build* must show its own clear state on the process graph / operational panel ("paused for upgrade `e8cba…`, resumes after swap"), not silently stall. Companion §1 (quiet ≠ dead) + §2 (situational awareness).

**A4 — Automatic recovery must still leave a visible audit entry (Phase 1–2).** The reliability win is that resume becomes invisible ("boot hooks observed as no-ops"). But a *silently* resumed build violates situational awareness — an operator returning to a build that jumped steps across a recycle has no idea it was interrupted. Emit a `step.recovered` / resume event onto the `agent-event-bus` / `UnifiedEvidenceTimeline` so the timeline records "interrupted at step X, resumed from journal": automatic, but not silent. Companion criterion 16 ("a silent self-heal must still leave a visible audit entry").

**A5 — Durability makes the `BI-BC8F667E` notification slice more urgent, not just "separate."** The direct consequence of this migration is that a build now legitimately runs unattended for hours and survives recycles and self-upgrade swaps. The moment that ships, "the build finished / a gate needs you while you were away" has **no delivery path** (the notification transport is wired only for self-upgrade — companion §3.2). Durability *without* the `BI-BC8F667E` Phase 1–2 notification slice makes a build *more* likely to silently complete or block unseen. Recommend they land in lockstep: this plan's **Phase 3** (journal-as-truth, where `awaiting-input` / `complete` become first-class) is the natural emit point for the events that slice consumes. Cross-reference, not scope creep.

## Sequencing & ownership

Phases are strictly ordered (0 → 1 → 2 → 3 → 4); Phase 1 is the first shippable PR. Each phase is one PR (Phase 3 possibly two: deletions vs. cost instrumentation). Operator reviews every PR; functional verification evidence (the kill tests) is attached to the PR description per `structural-verification-is-not-functional`. The experience-layer BI (`BI-BC8F667E`) consumes the journal as truth source starting Phase 3 but is planned separately.

---

## Phase 0 findings — dated addendum (2026-06-10, live install)

Both empirical unknowns answered. Method, raw evidence, and design consequences recorded per the Phase-0 verification contract. Operator approved the protocol ("go", 2026-06-10); Part 2 ran against the live portal (second restart, same approved action class, same idle window) instead of the contributor preview, to avoid the known dev-portal node_modules pollution risk.

### F1 — The in-sandbox CLI process SURVIVES portal death (Part 1: answered, decisively)

**Method.** Replicated the exact dispatch topology from `claude-dispatch.ts`: runner script base64-written into `dpf-sandbox-1`, launched as `docker exec --user node dpf-sandbox-1 /tmp/spike-run.sh` held open from inside the portal container — the same process tree as `spawn("docker", ["exec", "--user", "node", SANDBOX_CONTAINER, runnerScript])`. The script ticked a marker file every 5s for 5 minutes. The portal container was restarted **twice** during the run (epochs 1781061376–378 and 1781061579).

**Result.** 60/60 ticks, **zero gaps through both restarts** (ticks 5→6 spanned restart #1 at 5s spacing; ticks 47→48 spanned restart #2 likewise). The portal-side `docker exec` client died with the portal both times; the sandbox process never noticed. (The final `survived-to-end` sentinel was not captured before cleanup — the cat raced the loop exit — but 60/60 gap-free ticks through both restarts is the complete evidence.)

**Design consequences.**
- **Phase 2's "detached job" pattern simplifies to output-redirection + re-attach.** The process layer is *already* portal-independent; what dies is only the portal-held stdout stream. The runner script should redirect output to `/tmp/<taskId>.out` inside the sandbox; re-attach = read the file + check process state by taskId. No new detach machinery, no completion-event network dependency — the poll-loop default in the plan is confirmed as the right shape.
- **NEW finding beyond plan assumptions — today's task timeout is a no-op against the CLI.** `claude-dispatch.ts` enforces its timeout via `proc.kill("SIGTERM")` on the docker-exec *client* (line ~270). By the same mechanism that produced F1, that signal never reaches the in-sandbox CLI: a timed-out specialist run almost certainly **keeps running (and burning tokens) in the sandbox** after the portal gives up on it. The Phase-2 per-task circuit breaker must kill by in-sandbox PID/job id (`docker exec dpf-sandbox-1 kill <pid>`), not by client signal. This is a live cost/correctness bug in the *current* path, discovered by the spike.

### F2 — Self-hosted Inngest re-delivers after function-server death; step re-runs, ~37s kill→re-invocation (Part 2: answered)

**Method.** Fired `ops/postgres-backup.requested` (event `01KTQRNQTBD07C7ZQM04NWRDH9`, sent from inside the portal so no key left the container), then restarted the portal 4s into the single-step function (`postgresBackupRequested`, `retries: 2`).

**Result.** Two `BackupRun` rows tell the whole story:

| row | status | startedAt | finishedAt |
|---|---|---|---|
| `cmq7i2qj2…` (attempt 1) | `running` — **orphaned** | 03:19:34.862 | *never* |
| `cmq7i3m9y…` (engine retry) | `ok` | 03:20:16.007 | 03:20:21.124 |

The engine detected the dead invocation and re-invoked against the rebooted portal **~37 seconds after the kill, with no human intervention and no boot hook** — the spec §3.1 mechanism confirmed on our pinned image. The step **re-ran** (at-least-once), it did not resume mid-dump: attempt 1's `running` row is stranded forever.

**Design consequences.**
- The orphaned `running` row is the **live specimen** of why every Phase-2 side-effecting step needs check-then-attach idempotency keyed by `taskId` — a re-invoked dispatch step without the guard would double-launch a specialist exactly like this. Row left in place deliberately (visible in the Backups admin) as dogfooding evidence.
- Kill→re-invocation latency (~37s: portal boot + engine retry) is the recovery-time floor to expect for Phase-1 step boundaries.

### F3 — Step memoization: deferred to Phase 1, as planned

No manually-triggerable multi-step function exists to prove "completed steps return memoized" without new code (the manual backup functions are single-step; the 4-step daily function is cron-only). Engine documentation + the deliberation-runner's skip-completed-branches behavior in production stand as indirect evidence; **direct proof lands with Phase 1's flagged `build/execute` function**, whose verification already requires observing memoized steps in the run trace.

### Environment notes (recorded for reproducibility)

Quiescence level was `normal` throughout (checked in `PlatformConfig` `portal.quiescence`); the stale `ready-to-swap`/`deferred` `QuiescenceRun` rows from prior upgrades are inert audit rows, not active state. No build was in flight (one build parked in `ideate` since 01:45Z — the operator-reported Build Studio misbehavior, untouched by this spike and still to be diagnosed separately). Zero `working` TaskRuns before, during, and after. Spike files removed from the sandbox; the only residue is the orphaned `BackupRun` row retained as evidence.

**Phase-0 exit: both unknowns answered; Phase 1 is unblocked and its design inputs are confirmed (poll/re-attach, in-sandbox kill for timeouts, idempotent start steps).**
