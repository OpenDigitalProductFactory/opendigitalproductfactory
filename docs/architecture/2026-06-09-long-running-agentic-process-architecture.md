# Durable Long-Running Agentic Processes — architecture assessment

**Date:** 2026-06-09
**Status:** Assessment / direction-setting. Not a build spec. The phased recommendations in §8 become backlog items, each promoted through Build Studio in the normal way.
**Audience:** Operator (Mark), platform architects, the Build Studio sub-agents, and any coworker that owns a process which runs longer than a single request.
**Scope:** Why Build Studio has been hard to make resilient and simple; what Cursor, Linear, and the durable-execution industry do instead; what substrate DPF *already has* (the durable engine **and** the operator-facing experience layer); and a single generalized pattern — the **Durable Agentic Process (DAP)** — that should govern Build Studio, marketing campaigns, monthly financial close, and every other long-horizon process.
**Companion docs:** [`platform-overview.md`](platform-overview.md) (runtime), [`ai-coworker-development-principles.md`](ai-coworker-development-principles.md) (how coworkers are designed), [`dpf-patterns.md`](dpf-patterns.md) (DPF-novel patterns), [`autonomy-and-wwmd.md`](autonomy-and-wwmd.md) (decision gates), [`2026-06-09-dap-experience-layer-design.md`](2026-06-09-dap-experience-layer-design.md) (UX design of layer 6 — trust, attention, situational awareness; grounded in the HCI literature).

**Substrate verification (EA review, 2026-06-09):** Every code claim below was checked against the live tree. Confirmed: `lib/integrate` contains **zero** `inngest.createFunction` calls; `build-pipeline.ts` carries the "replaces the fire-and-forget autoExecuteBuild with resumable step checkpoints" header; the three boot hooks exist in `instrumentation.ts`; `MAX_MERGE_RETRIES = 1` at [`build-orchestrator.ts:1352`](../../apps/web/lib/build/build-orchestrator.ts); `TaskRun` carries `status`/`source`/`lastHeartbeatAt` with a `[status, lastHeartbeatAt]` watchdog index ([`build-delivery.prisma`](../../packages/db/prisma/schema/build-delivery.prisma)); **Inngest runs as a separate self-hosted container** ([`docker-compose.yml:666`](../../docker-compose.yml)). Findings that *sharpen* the recommendation rather than weaken it: §3.1 (out-of-process Inngest is what makes the thesis hold), §7.4 caveat (builds don't own a `TaskRun` yet — the migration stands one up), §7.5/§7.6 (Inngest's replay/determinism constraints, the absence of native versioning, and the single-engine concentration risk are the real costs — §7.6 raises open design question #1), §7.3 (external GL postings need an explicit dedup mechanism — Inngest's at-least-once is not exactly-once on its own), and §9.7 (Decision B's volatile market numbers independently re-checked; three softened).

**External-claims verification (2026-06-09):** The load-bearing external figures were independently checked against primary sources (§10). Confirmed: Inngest's hard limits (4MB/step, **32MB/run-state** — the binding one, 1000 steps, ≤2h/step) and its HTTP-per-step execution model (§7.5); the Anthropic **2026-06-15** billing split moving programmatic/headless Claude Code onto a metered credit pool at API rates (§9.3); prompt-cache reads at **0.1× input / 90% off** with a default 5-min TTL (§9.6). The open-weight quality figures (§9.4) check out by *model identity* (DeepSeek V4-Pro, Kimi K2.6, GLM-5.1, MiniMax M3 are real June-2026 releases) but the precise point-gaps are benchmark-sensitive — treated as directional, with the strategic conclusion shown to survive the noise. Two corrections folded in below: §7.5 now states the real Inngest numbers instead of "validate later," and adds the **recovery-granularity / decouple-the-long-step** risk (a 40-min CLI dispatch wrapped as one step re-runs wholesale on a portal recycle) — the single architectural point the prior draft understated.

---

## 0. TL;DR

1. **The engine is not missing.** DPF already runs Inngest as a durable-execution engine (`step.run` journaling, retries, concurrency limits, cron) and already has a *generic* long-running-process substrate: the `TaskRun` lifecycle, the `QuiescenceRun` state machine, the `StallEvent` heartbeat watchdog, and the marketing `ScheduledOutboundAction` dispatcher. This is, point-for-point, the architecture the rest of the industry converged on in 2025–2026.

2. **Build Studio is the outlier.** Its orchestrator ([`apps/web/lib/build/build-orchestrator.ts`](../../apps/web/lib/build/build-orchestrator.ts)) is a **bespoke, fire-and-forget, in-portal loop that runs *outside* the durable substrate**. It re-implements — partially and fragilely — the very things Inngest already does: resume (by *title match*, not journal), retry (single attempt, then silent loss), and crash recovery (boot-time reconciliation hooks bolted on in `instrumentation.ts`). That is the root cause of "no task-level resume," "stranded builds," and "self-upgrade kills the build."

3. **Cursor, Linear, and Anthropic all teach the same lesson.** Make the *task itself* a durable object that outlives any process or VM (Cursor → Temporal; Linear → `AgentSession`; Anthropic → "resumable execution with retry logic and regular checkpoints"). Decouple the agent loop from the machine. Give the process an explicit, **user-visible** state machine with first-class `awaiting-input`, `error`, and `stale` states. Keep a human as the accountable owner at a non-bypassable gate. Enforce liveness contracts so stuck agents are *detected*, not silent.

4. **The fix is convergence, not a new framework.** Don't adopt Temporal. Move Build Studio's orchestration *onto the durable substrate DPF already runs*, and promote that substrate into a named, reusable **Durable Agentic Process** pattern. Then marketing campaigns and monthly close are *instances of the same pattern*, not new bespoke pipelines.

5. **Durability the operator can't see isn't finished.** The same convergence covers the *experience*: a user-visible state machine (Linear), an editable plan (Cursor Plan Mode), and detected-not-silent liveness are UX contracts, not just backend ones. DPF has *already* built a rich operator-facing layer for exactly this — the Build Studio operational panel, `TruthSourceBadge`, `ProcessGraph`, stall-recovery actions, the decision-gate panel — but, precisely mirroring the durability story, it is bespoke to Build Studio (`components/build/*`). The DAP pattern must generalize the experience layer too (§3.2, §6 layer 6), or every new instance re-invents its console — and likely re-introduces the silent-failure UX the build layer already fixed.

This assessment respects [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md): the recommendation is to *use what exists*, and the single new thing proposed (a thin `ProcessRun` generalization of `TaskRun`) is justified in §7.4 against the substrate that is already there.

---

## 1. The problem, stated precisely

Build Studio is a five-phase agentic pipeline (`ideate → plan → build → review → ship`, plus terminal `complete`/`failed`) defined in [`apps/web/lib/explore/feature-build-types.ts:441`](../../apps/web/lib/explore/feature-build-types.ts) with the transition matrix at [`feature-build-types.ts:657`](../../apps/web/lib/explore/feature-build-types.ts). The build phase is driven by `runBuildOrchestrator()` at [`apps/web/lib/build/build-orchestrator.ts:951`](../../apps/web/lib/build/build-orchestrator.ts), entered fire-and-forget via `autoExecuteBuild()` (defined at [`apps/web/lib/actions/build.ts:735`](../../apps/web/lib/actions/build.ts), called at `:710`/`:876`/`:908`/`:1149`).

We have spent months hardening it and it remains fragile. The concrete, observed failure modes:

| Symptom | Mechanism in the code today | Memory / PR trail |
|---|---|---|
| **No task-level resume on restart** | Task results stored by **title**, matched on resume by string equality (`getCompletedTaskTitles()` [`build-orchestrator.ts:712`](../../apps/web/lib/build/build-orchestrator.ts)); a re-plan that renames/reorders tasks breaks the match → duplicate or skipped work. No per-step journal. | known limitation |
| **Stranded builds** | `autoExecuteBuild()` is fire-and-forget in the portal process; a portal recycle kills it mid-flight. Recovery is a *boot hook* (`resumeStrandedBuildsOnBoot` [`instrumentation.ts:305`](../../apps/web/instrumentation.ts)) that re-dispatches stale rows — i.e. crash recovery is bolted on outside the execution model. | — |
| **Contradictory checkpoint states** | `buildExecState` can land in self-contradictory shapes (missing-step, error-without-fail, complete-no-verify); a second boot hook `recoverContradictoryBuildExecStatesOnBoot` [`instrumentation.ts:214`](../../apps/web/instrumentation.ts) classifies and clears them. | — |
| **Self-upgrade kills in-session work** | A bundle-hash change recycles the portal container; the in-portal orchestrator dies. Quiescence + boot reconciliation (`reconcileSelfUpgradeRunsOnBoot` [`instrumentation.ts:119`](../../apps/web/instrumentation.ts)) patch around it. | self-upgrade-kills-in-session-ux |
| **Lost task evidence** | `taskResults` write uses optimistic locking with `MAX_MERGE_RETRIES = 1` ([`build-orchestrator.ts`](../../apps/web/lib/build/build-orchestrator.ts)); on a second collision the write is **silently dropped** and the build proceeds as if it succeeded. | — |
| **Runaway / silent agent runs** | Specialist runs have a retry cap but no firm per-task timeout; a hung CLI can consume most of the 40-min orchestrator budget. Mechanism questions previously spun 200 iterations. | mechanism-question-grounding-gap |

Every row is the *same shape of bug*: the orchestrator is a long-running stateful loop that the runtime can kill at any instant, and durability has been retrofitted around it instead of being a property of how it executes. We keep adding boot-time reconciliation hooks because the execution model gives us no checkpoints to resume from.

---

## 2. What the industry does instead (2025–2026 state of the art)

Full citations in §10. The convergence is striking — execution-layer vendors (Cursor) and coordination-layer vendors (Linear) arrived at the same primitives from opposite ends.

### 2.1 Cursor — durable execution decoupled from the machine

Cursor's Cloud/Background Agents are the most load-bearing public example. Their June 2026 engineering retrospective is explicit:

- The **agent loop runs on Temporal durable execution, *not* on the VM**. It survives "blips in inference reliability, pod hibernation and resumption, and runs that stretch across days or even weeks," at "more than 50 million actions per day across more than 7 million unique workflows," reaching two-nines reliability *after* the Temporal migration.
- Three **decoupled** components: (1) the agent loop (in Temporal), (2) machine state (isolated VMs with independent lifecycle, using checkpoint/restore/fork snapshots), (3) conversation state (append-only, streamed to clients).
- Their framing: the work "looks less like porting a local agent to a server and more like **building an operating layer around it**" — "enterprise IT for agents."
- Parallelism is made safe by **isolation**: up to 8 agents per prompt, each in its own git worktree or machine; agents produce **merge-ready PRs**, gated by native code review and command-approval — never self-merge.
- **Plan Mode**: research → an *editable markdown plan / to-do list* → execute; when execution diverges, **revert and re-plan** rather than patch in place.

### 2.2 Linear — the task as a durable, observable session

Linear's Agent Interaction Protocol (SDK shipped 2025-07-30) is the coordination-layer mirror image:

- The **`AgentSession`** is the durable unit of work, auto-created when an agent is @mentioned or delegated an issue, driven by webhooks.
- An **explicit, user-visible six-state machine**: `pending · active · error · awaitingInput · complete · stale`, updated automatically from the agent's emitted activities. State is a *product surface*, not a log line.
- Progress is reported as **five semantic activity types** (`thought · action · elicitation · response · error`) plus optional **Agent Plans** (step-status checklists).
- **Human accountability via delegation**: assigning an issue to an agent sets it as **`delegate`, not `assignee`** — "humans maintain ownership while agents act on their behalf." A human makes the final merge approval.
- **Liveness contracts**: the webhook must be acknowledged within 5s and the agent must emit an activity within 10s or the session is marked unresponsive; `stale` is a first-class state.

### 2.3 Durable-execution engines and Anthropic's guidance

- **Durable execution** (Temporal, Restate, DBOS, AWS Lambda Durable Functions, Cloudflare Workflows, **Inngest**, Trigger.dev) all share one mechanism: **journal each step to a persisted log; on crash/deploy/timeout, resume from the last completed step instead of restarting.** Side effects (LLM calls, tool calls) are isolated into individually retryable, idempotent units. Nearly every one shipped an explicit *agent* integration in 2025.
- **Anthropic, "Building Effective Agents":** prefer **workflows** (LLMs orchestrated through predefined code paths) over free-running **agents** wherever you can; start simple; the durable patterns are prompt-chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer.
- **Anthropic, multi-agent research system:** "minor system failures can be catastrophic for agents" because errors compound → combine "the adaptability of AI agents … with deterministic safeguards like **retry logic and regular checkpoints**" and **resumable execution**. Use **rainbow deployments** so a deploy doesn't kill in-flight agents (this is the published answer to our self-upgrade problem).
- **Context engineering:** persist the **plan and a scratchpad as durable artifacts**; compact aggressively; isolate sub-agents in their own context windows; retrieve just-in-time.

### 2.4 The shared pattern

Both Cursor and Linear, and the durable-execution field generally, converge on six primitives:

1. **A durable unit of work that outlives any single process** (Temporal workflow / `AgentSession` / journaled run).
2. **An explicit, user-visible status state machine** with `awaiting-input`, `error`, and `stale` as first-class states.
3. **A non-bypassable human accountability gate** at the consequential boundary (merge / publish / post).
4. **Reasoning decoupled from execution** so each can fail, hibernate, and resume independently.
5. **Isolated, reproducible execution environments** to make parallelism safe.
6. **Liveness/heartbeat contracts** so stuck work is detected, not silent.

Plus: **plan-as-editable-artifact**, **bounded autonomy via external circuit breakers**, and **deploy-without-killing-in-flight-work**.

Note that four of the six — the visible state machine (2), the human gate (3), plan-as-artifact, and detected liveness (6) — are **experience** contracts as much as execution ones. They are satisfied only if the *operator* can see the state, act on the gate, edit the plan, and notice the stall. A journal no human reads is observability for engineers, not a product surface — which is why Linear treats state as a product surface and Cursor ships Plan Mode as UI, not config.

---

## 3. What DPF already has (verify-substrate-first)

The good news, and the reframe: **DPF already implements most of §2.4.** It is not missing the engine. It is missing the discipline of putting *all* long-running work on the engine, and the discipline of naming the pattern so it is reused.

| Industry primitive | DPF substrate that already exists | Where |
|---|---|---|
| Durable execution engine (journal + retry + cron) | **Inngest** — `step.run` journaling, per-function `retries`, `concurrency` limits, and the cron + event function registries in `queue/functions/index.ts` (59 scheduled and 35 event functions as of 2026-08-16). Counts drift with every new job, so treat `lib/operate/scheduled-jobs/catalog.ts` as the authority — a parity test fails the build if a scheduled function is missing from it | [`apps/web/lib/queue/inngest-client.ts`](../../apps/web/lib/queue/inngest-client.ts), [`apps/web/lib/queue/functions/index.ts`](../../apps/web/lib/queue/functions/index.ts) |
| Durable unit of work / session | **`TaskRun`** — universal task tracker with status enum (`submitted·working·input-required·auth-required·completed·failed·canceled·rejected·archived`), `source`, heartbeat | `schema.prisma` `TaskRun`; [`apps/web/lib/tak/autonomous-work-run.ts`](../../apps/web/lib/tak/autonomous-work-run.ts) |
| Explicit multi-state state machine + checkpoints | **`QuiescenceRun`** — `pending → preparing → draining → ready-to-swap → swapping → completed`, `enteredStateAt` JSON timestamps, snapshots, heartbeat | [`apps/web/lib/queue/functions/quiescence-run.ts`](../../apps/web/lib/queue/functions/quiescence-run.ts) |
| Liveness / staleness contract | **`StallEvent`** + `TaskRun.lastHeartbeatAt` + `taskrun-watchdog` cron (retry/abandon/escalate) | [`apps/web/lib/queue/functions/taskrun-watchdog.ts`](../../apps/web/lib/queue/functions/taskrun-watchdog.ts) |
| HITL suspend/resume + approval gate | **WWMD decision gate** (`principle_decide`) wired into phase advancement; approval state recorded on the row. The plan→build and ship gates additionally run **advisory acumen consults** — each acumen impacted by the phase's planned file paths is asked through its WSID profession gate, and the results are attached to the gate result and recorded as DI-ledger rows. Advisory by contract: an acumen outcome never changes the gate's `allowed` verdict. Paths are resolved from the build's Workroom change-impact contract (falling back to the plan document; the realized diff wins at ship) and resolution is fail-open — if it yields nothing, the gate behaves exactly as it did before consults existed | [`apps/web/lib/decision-perspective/build-studio-gate.ts`](../../apps/web/lib/decision-perspective/build-studio-gate.ts), [`planned-file-paths.ts`](../../apps/web/lib/decision-perspective/planned-file-paths.ts) |
| Scheduled outbound action dispatcher (saga-ish) | **`ScheduledOutboundAction`** (`pending → fired/failed`) + marketing `tickScheduler()` | [`apps/web/lib/marketing/scheduler.ts`](../../apps/web/lib/marketing/scheduler.ts) |
| Multi-branch parallel agent work + resume | **`DeliberationRun` / `TaskNode` DAG** (skips completed branches on re-run) | [`apps/web/lib/queue/functions/deliberation-run.ts`](../../apps/web/lib/queue/functions/deliberation-run.ts) |
| Autonomous agent loop + tool grants | `resolveAgent → resolveTools → executeAgenticLoop`; grant implication graph | [`autonomous-work-run.ts`](../../apps/web/lib/tak/autonomous-work-run.ts), [`apps/web/lib/tak/agent-grants.ts`](../../apps/web/lib/tak/agent-grants.ts) |
| Renderer-neutral product-surface context | Principal-bound Authorized Surface sessions expose semantic state, validation, and governed actions to browser, mobile, workroom/headless, scheduled, background, and external execution | [`authorized-surface-runtime.ts`](../../apps/web/lib/coworker/authorized-surface-runtime.ts), [`surface-pack.ts`](../../apps/web/lib/mcp/packs/surface-pack.ts) |
| Deploy-without-killing-in-flight (rainbow-ish) | **Quiescence protocol** drains activity before container swap | [`quiescence-run.ts`](../../apps/web/lib/queue/functions/quiescence-run.ts) |
| Cross-ring observation envelope | **`GearInterface`** (additive evidence at ring boundaries) | [`dpf-patterns.md` §1.1](dpf-patterns.md) |
| Operator progress visibility (truth-source-honest) | **Build Studio operational panel** — N/M task counter, `TruthSourceBadge`, stale-conflict detection, quiet-agent watchdog with a "view last action" deep-link | [`BuildProgressOperationalPanel.tsx`](../../apps/web/components/build/BuildProgressOperationalPanel.tsx), [`progress-visibility.ts`](../../apps/web/lib/build/progress-visibility.ts) |
| Root-cause-first failure rendering | **Dispatch history card** — classified `BuildFailureAxis` shown above raw stdout/stderr | [`BuildDispatchHistoryCard.tsx`](../../apps/web/components/build/BuildDispatchHistoryCard.tsx) |
| Visible state machine as product surface | **`ProcessGraph`** — phase/task/fork-join nodes with inspectors; `PhaseIndicator` / `PhaseMiniRail` / `QueueStateBadge` | [`ProcessGraph.tsx`](../../apps/web/components/build/ProcessGraph.tsx), [`WorkflowStageInspector.tsx`](../../apps/web/components/build/WorkflowStageInspector.tsx) |
| Operator recovery affordances | **`StalledTaskRecoveryActions`** (retry / abandon / escalate) + `StallEventHistoryStrip` + a stall-thresholds admin page | [`StalledTaskRecoveryActions.tsx`](../../apps/web/components/platform/StalledTaskRecoveryActions.tsx), [`StallEventHistoryStrip.tsx`](../../apps/web/components/build/StallEventHistoryStrip.tsx) |
| HITL gate as a product surface | **`DecisionPerspectiveGatePanel`** + `ActionBanner` capture escalate/defer outcomes; a `decline` outcome renders as a settled answer rather than a pending capture | [`DecisionPerspectiveGatePanel.tsx`](../../apps/web/components/build/DecisionPerspectiveGatePanel.tsx) |
| Unified evidence / activity timeline | **`UnifiedEvidenceTimeline`** over the agent-event-bus stream | [`UnifiedEvidenceTimeline.tsx`](../../apps/web/components/build/UnifiedEvidenceTimeline.tsx) |
| Notification transport | **notifications API + adapter** (currently wired for self-upgrade only — *not* for build / gate / completion events) | [`app/api/v1/notifications`](../../apps/web/app/api/v1/notifications), [`notification-adapter.ts`](../../apps/web/lib/queue/notification-adapter.ts) |

The marketing scheduler and deliberation runner are *already built the right way* — as Inngest functions over generic state-tracked rows. Build Studio predates this discipline and never moved onto it.

### 3.1 Why this actually survives a crash: Inngest is out-of-process

The whole thesis hinges on one deployment fact that must be stated explicitly, because the obvious reviewer objection is *"if the portal dies, doesn't Inngest die with it?"* It does not. Inngest runs as a **separate self-hosted container** (`inngest/inngest:latest`) with its **own Postgres database and Redis** ([`docker-compose.yml:666`](../../docker-compose.yml)). The portal is a *stateless function-server* to Inngest: on boot it PUTs its function catalog to `/api/inngest` (self-hosted Inngest does **not** auto-discover apps — registration is explicit, `DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED`), and thereafter Inngest *invokes the portal* one step at a time, persisting each step's result in its own store.

The consequence is exactly what the in-process loop cannot give us: **when the portal recycles mid-run, the durable run does not.** Inngest holds the journal, notices the invocation failed or timed out, and re-invokes the step against the *new* portal instance — completed steps return memoized results, execution continues from the first un-journaled step. This is the mechanism that deletes the boot-reconciliation hooks: crash recovery moves from "the portal re-scans the DB on boot for orphans it left behind" to "the engine that never died retries the step." It is also the precise reason the marketing dispatcher and deliberation runner have *never needed* stranded-row recovery hooks, while Build Studio needs three.

### 3.2 The experience layer exists too — and has the same Build-Studio-only problem

The durability story has an exact UX twin. Over the 2026-05 progress-visibility overhaul, DPF built a genuinely good operator-facing layer for *watching, steering, and recovering* a long-running process (the bottom rows of the table above). It even includes a DPF-novel pattern the industry references don't name: **truth-source honesty** — when the agent's chat self-report disagrees with newer DB / sandbox / verification state, `TruthSourceBadge` shows *which* signal and *how old*, and `hasStaleTruthConflict` surfaces the disagreement rather than silently trusting one. That is `awaiting-input` / `stale`-as-product-surface done right, and it is worth elevating to a named pattern (§5, criterion 14).

But every one of those components lives under `components/build/*` and is wired to `FeatureBuild` / `buildExecState`, not to a generic run. So the experience layer is bespoke to Build Studio in exactly the way the *execution* layer is. A `kind="campaign"` or `kind="month-close"` DAP would today re-invent the process graph, the progress panel, the gate panel, the recovery actions, and the timeline from scratch — and would very likely re-introduce the silent-failure UX the build layer already fixed. **Generalizing the experience layer is therefore a first-class part of the DAP convergence, not a follow-on polish task.**

Two real gaps remain even *within* Build Studio, and they are the operator's sharpest pain points:

- **The plan is read-only in the UI.** "Revise the plan" means looping back through a coworker conversation, not editing the artifact — counter to the plan-as-editable-artifact principle (§5, criterion 17) and to Cursor's Plan Mode.
- **There is no push / notification path for "your build is done" or "a gate needs your decision."** The notifications API exists but is wired only for self-upgrade, so a process that runs for hours silently assumes the operator is watching the tab. For a non-technical operator who *makes decisions but doesn't run the system*, this is the difference between the platform working and appearing dead.

---

## 4. The gap, named

> **Build Studio's orchestrator runs the agent loop inside the portal's request/process lifetime, not inside Inngest's durable step model. Every resilience problem follows from that one decision.**

Concretely:

- `runBuildOrchestrator()` ([`build-orchestrator.ts:951`](../../apps/web/lib/build/build-orchestrator.ts)) is plain async code, invoked **fire-and-forget** (`autoExecuteBuild(buildId).catch(...)` at [`build.ts:710`](../../apps/web/lib/actions/build.ts), `:876`, `:908`, `:1149`). It is **not** an Inngest function — `lib/integrate` contains zero `inngest.createFunction` calls. So it gets **none** of `step.run`'s journaling, automatic retry, or resume-from-last-step. (Contrast: the marketing dispatcher, eval/probe runs, deliberation, and discovery *are* Inngest functions.)
- **The team already noticed the gap and hand-rolled the cure at the application layer.** [`build-pipeline.ts`](../../apps/web/lib/build/build-pipeline.ts) is, by its own header, a "checkpoint-based build execution pipeline [that] replaces the fire-and-forget autoExecuteBuild with resumable step checkpoints": it has `getResumeStep()`, a `STEP_ORDER`, per-step `MAX_RETRIES`, `RETRY_DELAYS_MS` backoff, and a `buildExecState` checkpoint persisted on every step. **This is a bespoke re-implementation of exactly what Inngest's `step.run` provides natively** — and because it is hand-rolled outside the durable engine, it still (a) dies with the portal process, (b) needs boot-hook recovery, and (c) only checkpoints the *coarse* pipeline steps; the 14 specialist tasks *inside* the build step still resume by **title match** (§1), not journal.
- Because the loop dies with the process, "crash recovery" had to be re-invented as boot-time reconciliation hooks in [`instrumentation.ts`](../../apps/web/instrumentation.ts) — three separate hooks (stranded, contradictory-state, self-upgrade), each patching a different way the loop can be interrupted.
- Because there is no durable workflow identity independent of the portal, self-upgrade (which recycles the portal) is destructive to in-flight builds, and we mitigate with quiescence + yet another boot hook.
- **Incidental finding (cleanup, not load-bearing):** the hand-rolled checkpoint layer exists in *two* files — [`apps/web/lib/build-pipeline.ts`](../../apps/web/lib/build-pipeline.ts) and [`apps/web/lib/build/build-pipeline.ts`](../../apps/web/lib/build/build-pipeline.ts). The migration in §7.1 deletes this layer wholesale, so the duplication resolves itself; flagged here only so the BI's "delete the retrofit" scope covers both paths.

This is not a criticism of the people who built it — `build-pipeline.ts` is a *good* response to the symptom. It is the textbook signature of a long-running process implemented as an in-process loop: you end up re-deriving the durable-execution engine by hand, one fix at a time. The entire durable-execution industry exists because this exact pattern doesn't survive contact with crashes and deploys. DPF already bought the cure (Inngest) and applied it everywhere *except* its most important long-running process — so the work is **convergence onto the engine, deleting the hand-rolled layer**, not building something new.

---

## 5. Design principles (the bar any long-running process must clear)

Distilled from §2–§4 and the founder kernel. These are the acceptance criteria for the target architecture.

1. **Durability is a property of execution, not a retrofit.** Journal each step; resume from the last completed step. Never re-implement resume at the application layer when the engine provides it. *(Inngest `step.run`.)*
2. **The process is a durable object with stable identity** independent of any portal process, container, or VM. *(Cursor Temporal workflow / Linear `AgentSession` → DPF `TaskRun`/`ProcessRun`.)*
3. **One explicit, user-visible state machine per process**, with `awaiting-input`, `error`, and `stale` as first-class states. State is a product surface. *(Linear six-state model.)*
4. **Workflows where you can, agents where you must.** The deterministic engine owns *what comes next and where artifacts live*; the model makes *bounded* decisions inside that frame. *(Anthropic; Praetorian/AWS consensus.)*
5. **Side effects are idempotent, individually retryable steps.** A step that re-runs must not double-execute (no silent dropped writes, no double-published campaign asset, no double-posted journal entry).
6. **Human accountability at a non-bypassable gate.** Consequential boundaries (ship a PR, publish a campaign, post to the GL) require a recorded human/operator approval. Governance approves *evidence, not provenance* — the gate ratifies evidence quality regardless of who produced it.
7. **Liveness contracts, not silent hangs.** Heartbeats + staleness thresholds + a watchdog that retries/abandons/escalates. *(Linear `stale`; DPF `StallEvent`.)*
8. **Bounded autonomy via external circuit breakers.** Per-step timeouts, iteration caps, and spend ceilings enforced *outside* the model so a runaway run "fails small, not crashes big."
9. **Plan as an editable, durable artifact**, with revert-and-re-plan preferred over patching an in-flight run. *(Cursor Plan Mode.)*
10. **Deploy without killing in-flight work.** Drain (quiescence) and/or run versions side-by-side (rainbow); pin a run to its workflow version. *(Anthropic rainbow deploys; DPF quiescence.)*
11. **Saga compensation for partial failure.** When a multi-step business process fails midway, run idempotent compensations to restore a consistent state rather than leaving half-done work.
12. **Observability + per-gate eval.** Replayable step traces (the journal *is* the trace) and automated evaluation at each gate, aligned to OpenTelemetry GenAI conventions where practical.

**Experience criteria** (a durable process the operator cannot see or steer is not done — Nielsen heuristic #1, *visibility of system status*):

13. **Continuous visibility of system status.** Every DAP renders its phase and status at all times; "is it still working?" is answered on-screen, not by asking. *Quiet ≠ dead* must be visible — the quiet-agent watchdog already does this for builds; it generalizes. *(NN/g heuristic #1.)*
14. **Truth-source honesty over false certainty.** When signals disagree (chat self-report vs. journal vs. sandbox vs. verification), show the source and its age and surface the conflict; never silently pick one. *(DPF `TruthSourceBadge` — elevate to a named pattern.)*
15. **Notify, don't poll.** `awaiting-input` and terminal outcomes *push* to the operator (notification + a cross-process inbox), because a multi-hour / multi-day process cannot assume anyone is watching the tab. Frame the decision in the operator's terms — a non-technical operator decides, the agent runs the system — never in `buildExecState` internals.
16. **Recovery affordances at the operator's altitude.** Every `error` / `stale` state offers a bounded next action — retry / abandon / escalate / edit-plan — in the UI, at the altitude the operator reasons about (the *process*), not only the engine's internal step. A silent boot-time self-heal must still leave a visible audit entry.
17. **The plan is an editable surface, not a transcript.** Criterion 9's editable plan is editable *in the UI*; revert-and-re-plan is a visible affordance, not "re-prompt a coworker and hope." *(Cursor Plan Mode.)*

---

## 6. Target architecture — the Durable Agentic Process (DAP)

A single pattern that every long-horizon process is an instance of. It is mostly *assembly of existing DPF substrate* under one name.

```
                        ┌─────────────────────────────────────────────┐
                        │  ProcessRun  (durable object, stable id)      │
                        │  - kind: build | campaign | month-close | …   │
                        │  - phase: domain state machine (explicit)     │
                        │  - status: working|awaiting-input|error|stale │
                        │  - plan: durable editable artifact            │
                        │  - heartbeat, version, evidence, audit        │
                        └───────────────┬─────────────────────────────┘
                                        │ drives
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                                ▼                                ▼
  Inngest workflow fn            Phase gates (HITL)              Watchdog (liveness)
  step.run per phase /           WWMD principle_decide           StallEvent +
  per task → journaled,          + recorded operator             taskrun-watchdog →
  retried, resumable             approval (non-bypassable)       retry/abandon/escalate
        │
        ▼
  Bounded sub-agent steps (orchestrator-workers)
  - each step: idempotent, per-step timeout, isolated context
  - emits semantic activity (thought/action/response/error) to agent-event-bus
  - circuit breaker: iteration cap + spend ceiling
        │
        ▼  (all of the above is rendered to, and steered by, the operator)
  Experience layer  (kind-agnostic; generalized from components/build/*)
  - process graph + phase/status        - truth-source-honest progress
  - awaiting-input → notify + inbox     - recovery affordances (retry/abandon/escalate)
  - editable plan artifact              - per-process evidence timeline
```

**The six composable layers, all already present in DPF:**

1. **Durable object** — generalize `TaskRun` into (or alias it as) `ProcessRun` with a `kind` discriminator and a domain `phase` (§7.4). One row, stable id, owns the state machine, plan artifact, evidence, heartbeat, and version.
2. **Durable execution** — the orchestration is an **Inngest function** with one `step.run` per phase (and per task within a phase). The journal gives resume-from-last-step *for free*, deleting the title-match resume logic and the boot-reconciliation hooks.
3. **Explicit state machine** — the domain phase enum (Build Studio's already exists; marketing/close get their own) *plus* the cross-domain status (`working/awaiting-input/error/stale`) borrowed from `TaskRun`. Both rendered in the UI.
4. **HITL gates** — `principle_decide` + recorded operator approval at consequential boundaries; suspend the workflow (`step.waitForEvent`) at the gate and resume on the approval event, rather than blocking a process.
5. **Liveness + circuit breakers** — `lastHeartbeatAt` + `StallEvent` watchdog + per-step timeout + iteration/spend caps.
6. **Experience layer** — the operator-facing surface that *renders* layers 1–5 and *feeds* the gate in layer 4: a `kind`-agnostic process graph, truth-source-honest progress, a cross-process inbox + notification transport for `awaiting-input` / terminal states, recovery affordances, and an editable plan. Generalized from the Build Studio components that already exist (§3.2), not built new. **Designed in depth — trust calibration, attention/notification policy, situational-awareness gates, progressive disclosure, the cross-process inbox, and UX acceptance metrics — in the companion [`2026-06-09-dap-experience-layer-design.md`](2026-06-09-dap-experience-layer-design.md).**

**Implemented external Task slice (2026-08-31):** ordinary MCP `TaskRun` submissions now use the existing self-hosted Inngest substrate as a durable execution outbox. Submission commits the task and immutable request/authentication binding before enqueue; the worker claims it with the canonical heartbeat-aware compare-and-set transition, runs the unchanged governed executor, and emits status only after committed transitions. A scheduled two-minute reconciliation job re-enqueues bounded pending work after a portal restart or lost delivery. Streamable HTTP GET/SSE pushes MCP `notifications/tasks/status`; `tasks/get` and `tasks/list` remain the recovery and compatibility path. This realizes “notify, don't poll” as **push first, bounded polling second**—not push-only—and deliberately avoids caller-selected webhooks or a second task ledger.

**Implemented async delivery projection (2026-09-04):** the Delivery task hub reads authorized durable async-operation handles through their server-owned `TaskRun` or Workroom binding. One event-only function registered in `queue/functions/index.ts` consumes committed async transition locators, re-reads canonical state, writes a deterministic `status-changed` activity to the existing Workroom ledger, and wakes the bounded list stream. Recent terminal transitions may also create one deduplicated semantic notification. The event payload never supplies status, Workroom, recipient, result, or notification authority, and this projection adds neither a scheduler nor a second execution or task ledger.

**What is deliberately *not* adopted:** Temporal/Restate/DBOS as a new engine. DPF already runs Inngest, which provides the same journaling/retry/resume semantics. Adding a second durable engine would violate single-source-of-truth and the simplicity principle. The lesson from Cursor is *"put the agent loop on durable execution,"* not *"use Temporal specifically."*

---

## 7. Applying DAP

### 7.1 Build Studio (the first and proving instance)

The migration is largely mechanical and removes more code than it adds in steady state — but it is not free, and the constraints that make it non-trivial are named in §7.5. The moves:

- **Wrap the orchestrator as an Inngest function.** `runBuildOrchestrator` becomes the body of a `build/execute.run` Inngest function; each pipeline step *and* each specialist dispatch becomes a `step.run`. Crash mid-build → Inngest resumes at the next un-journaled step.
- **Absorb the hand-rolled checkpoint layer.** `build-pipeline.ts`'s `getResumeStep`/`MAX_RETRIES`/`RETRY_DELAYS_MS`/`buildExecState` are replaced by Inngest's native step journal and retry policy. This deletes code, not adds it.
- **Delete title-match resume** (`getCompletedTaskTitles`) for the per-task layer — the journal replaces it. Keep an immutable `taskId` on the plan only where stable identity is genuinely needed (see §1 fragility on re-plan/reorder).
- **Delete the boot-reconciliation hooks** in `instrumentation.ts` for stranded/contradictory builds — Inngest's own recovery covers stranded; contradictory states stop occurring because writes are journaled steps.
- **Fix the silent dropped write** (`MAX_MERGE_RETRIES = 1`): make the `taskResults` write its own idempotent `step.run` keyed by `taskId`, so a retry is safe and never silently lost.
- **Per-specialist timeout + iteration/spend caps** as explicit circuit breakers (principle 8).
- **Self-upgrade** stops being destructive: a build is a durable workflow with a version; quiescence drains, and the workflow resumes post-swap. This directly retires the self-upgrade-kills-in-session-ux class of bug.
- **Keep** the WWMD phase gates, the design-review severity gate, deliberation, and the agent-event-bus progress stream — they already match the pattern.
- **Operator experience** — Build Studio *already* has the richest surface (operational panel, dispatch history, process graph, stall recovery, gate panel). The migration must **re-point these at the journal as the truth source** — the Inngest step trace *becomes* the evidence timeline — and preserve truth-source honesty. Net UX win: "stranded" and "contradictory state" stop being operator-visible failure states because the engine no longer produces them. Close the two in-Build-Studio gaps from §3.2 here: in-UI plan editing and a "build done / gate needs you" notification.

Net: Build Studio gets simpler (less bespoke durability code) *and* more resilient (durability from the engine). That is the resolution of the "resilience vs. simplification" tension we have been fighting.

### 7.2 Marketing campaigns

Already two-thirds there (`ScheduledOutboundAction` + `tickScheduler`). To make a *campaign* a first-class DAP:

- **`ProcessRun(kind="campaign")`** with phase machine: `brief → draft → review → schedule → publish → measure → optimize`.
- Each outbound action (draft asset, publish approved draft, pull KPIs) is an **idempotent step** keyed by asset id — re-running the publish step must not double-post (principle 5).
- **HITL gate before publish** (operator approval is the non-bypassable boundary, mirroring Build Studio's "ship" gate). The existing `MarketingAutomationCandidate` approval model fits here.
- **Saga compensation**: if a multi-channel publish partially fails, compensate (unpublish/retract the posted channels or mark for manual reconciliation) rather than leaving a half-published campaign.
- **Measure → optimize loop** is an evaluator-optimizer workflow (Anthropic pattern): pull KPIs, evaluate against targets, propose the next round of assets back into `draft`.
- **Operator experience** — reuse the generalized process graph, gate panel, and evidence timeline rather than building a separate marketing console; the pre-publish gate *is* `DecisionPerspectiveGatePanel`, and measure→optimize renders as KPI cards feeding the next `draft`. This instance is the proof that the §3.2 experience layer actually generalizes.

**Cadence is now posture-driven (BI-C26FE785, 2026-08-26).** `planUpcomingForAssetTasks()` previously scheduled every drafter run at a fixed `ADVANCE_DAYS_FOR_DUE_WINDOW = 3`. It now takes the resolved `marketing-campaign` proactivity posture and varies the lead time with it: `quiet` suppresses planning outright (planning-then-staying-silent would still spend model budget and fill the outbound queue behind the operator's back), `balanced` keeps the standard lead time, and `assertive` starts creative earlier — falling back to the standard lead time rather than skipping when the longer one would land in the past, so a more assertive posture can never schedule *less* work than a calmer one.

This matters for the DAP framing above because it makes the `brief → draft` transition a governed decision rather than a constant. The HITL gate is unchanged and now doubly enforced: the resolver caps `marketing-campaign` at an `actionBoundary` of `propose` for every level, and because the posture ladder only ever tightens, no room declaration or operator preference downstream can loosen it to `preauthorized`. Publishing therefore remains reachable only through the approval queue, which is the non-bypassable boundary this section already required.

### 7.3 Monthly financial close / "balancing the books"

The highest-stakes instance, and the one where durability + auditability + idempotency matter most. The finance skills already exist (`finance:close-management`, `finance:reconciliation`, `finance:journal-entry`, `finance:financial-statements`).

- **`ProcessRun(kind="month-close")`** with phase machine: `cutoff → accruals → reconciliations → intercompany → adjustments → review → statements → sign-off`. Each is a known step with known waits and approvals → squarely a **workflow, not a free-running agent** (principle 4; AWS's own decision rule).
- **Recurring trigger**: an Inngest cron (or `ScheduledAgentTask`) fires the close on the close calendar; the `close-management` skill sequences tasks/dependencies.
- **Idempotency is non-negotiable, and "exactly-once" needs a precise mechanism.** Inngest gives *at-least-once* step execution with memoization — a step's result is replayed on resume, but the engine cannot make a write to an *external* ledger (GL/ERP) exactly-once on its own. True exactly-once posting therefore requires one of: **(i)** the external system honoring a client-supplied idempotency key on the posting API, or **(ii)** a local dedup ledger keyed by `(period, entry-hash)` that the step checks-and-claims *before* posting and records *after*. A re-run of "post accruals" must hit that key and no-op, never double-post. This is the saga + idempotency pattern doing real financial work — and the one place where Inngest's at-least-once semantics are not sufficient by themselves.
- **HITL sign-off gate**: CFO/operator approval is the non-bypassable boundary before statements are finalized; recorded as evidence (governance approves evidence).
- **Compensation**: a failed posting reverses cleanly; a failed reconciliation escalates via `StallEvent`, it does not silently pass.
- **Quiescence analog**: a "close window" can drain/pause new transactions, reusing the quiescence state-machine shape rather than inventing one.
- **Operator experience** — the CFO / operator sees a close checklist with per-step status and a sign-off gate; idempotent posting surfaces as an "exactly-once / posted" badge; a failed posting shows its compensation/reversal affordance, never a silent pass. Same gate panel and timeline as the other instances, finance `kind` — the strongest evidence that "state as a product surface" pays for itself where auditability is non-negotiable.

### 7.4 The one new substrate, justified

The only genuinely new thing proposed is a **thin generalization of `TaskRun` into `ProcessRun`** (or, cheaper, *using `TaskRun` as-is with a richer `kind`/`source` and a `phase` field). Justification against [`verify-substrate-before-proposing-new`](../founder-kernel/wiki/principles/verify-substrate-before-proposing-new.md):

- `TaskRun` already has the status state machine, heartbeat, source discriminator, and JSON payload. It is *already* the task tracker for chat, scheduled, and deliberation sources, and its `source` enum reserves a `build` value.
- **Caveat (verified, 2026-06-09):** Build Studio does **not** create a per-build `TaskRun` today — `build-orchestrator.ts` only *optionally* threads an existing `taskRunId` to tie a build's deliberation into a work unit ([`build-orchestrator.ts:415`](../../apps/web/lib/build/build-orchestrator.ts)); the build's own durable identity lives on `FeatureBuild`, not a `TaskRun`. So "extend `TaskRun`" is not a pure column-add for Build Studio: the migration must **stand up a per-build durable run** (the Inngest function's `runId` + a `TaskRun`/`FeatureBuild` 1:1 link) as the stable identity §5 principle 2 requires. Scope the BI accordingly.
- What it lacks for the DAP pattern: a **domain phase** field (Build Studio keeps its phase on `FeatureBuild`; marketing/close would otherwise each invent one) and a first-class **plan artifact** pointer.
- Recommendation: **do not create a parallel `ProcessRun` table.** Extend `TaskRun` (add `phase`/`planRef` JSON, formalize `kind`), and let each domain keep its rich detail in its own table (`FeatureBuild`, a future `Campaign`, a future `ClosePeriod`) linked 1:1. This preserves single-source-of-truth and avoids a second task ledger — exactly the restraint `dpf-patterns.md` §1.1 prescribes for `GearInterface`.

This must be confirmed by a substrate grep + live-backlog sweep at BI-filing time, not taken on this doc's word.

### 7.5 Migration risks and Inngest's own constraints

"Put the loop on the engine" is the right direction, but durable execution swaps one set of constraints for another. These must be designed for in Phase 0, not discovered in production. None is a blocker; each is a known cost that the "mechanical" framing of §7.1 should not hide.

- **Step output is journaled, so it has a hard size budget.** Inngest persists every `step.run` return value to durable state and replays it on resume. The documented limits (Inngest usage-limits, confirmed 2026-06-09): **4MB per step output, 32MB total per run-state, 1000 steps per function.** The *binding* one for Build Studio is the **32MB whole-run cap**, not the per-step 4MB: a build fans out 14 specialist tasks plus phase steps, and if each inlines a diff/transcript the run-state blows the 32MB ceiling and the run hard-fails. So the build's expensive outputs — full diffs, CLI transcripts, specialist results — must **not** be returned inline as step output. Store them by reference: write the artifact to its existing home (the `FeatureBuild`/`taskResults` row, an evidence record) inside the step and return only a pointer/id. This is also what makes the idempotent-write fix (§7.1) land cleanly. (The 1000-step ceiling is comfortable — a build is tens of steps, not thousands — but confirm it against the pinned Inngest image at spec time.)
- **Replay determinism is a hard requirement.** On resume, Inngest re-executes the function body up to the last completed step. Any logic *outside* a `step.run` — reading mutable DB state, time, randomness, branching on "live" values — must be deterministic across replays or wrapped in a step. The current orchestrator reads portal state freely; the migration's real work is auditing that control flow, not the wrapping itself. Plan for this refactor explicitly.
- **Step identity must be stable.** `step.run` memoizes by step id. Dynamically named or conditionally-ordered steps (the exact failure mode behind today's title-match resume) reintroduce the same bug inside the engine. Give each phase and each specialist task a **stable, content-independent step id** (e.g. the immutable `taskId` retained per §7.1), not a title.
- **Long wall-clock is a feature here, not a risk.** Because each step is a separate journaled invocation, a DAP run is *not* bounded by a single function timeout the way a Lambda-style handler is — it can legitimately span the 40-min budget, a portal recycle, and a self-upgrade swap. Inngest supports steps up to **2 hours** (hosting-dependent) and `step.sleep` up to a year. This is precisely the property Build Studio lacks today; call it out as the payoff, but still set explicit per-step timeouts (principle 8) so an individual hung step fails small.
- **Recovery granularity = step granularity — so don't wrap a 40-min CLI run as one monolithic step.** This is the subtle, load-bearing one. Inngest invokes each step as a *single held-open HTTP request* to the portal and only journals the step's **return**; it does not checkpoint *inside* a running step. So if a specialist's CLI dispatch is one `step.run` that runs 40 minutes and the portal recycles (or self-upgrade swaps) at minute 39, Inngest re-invokes that whole step against the new portal and the CLI **starts over** — better than today (the whole build no longer dies) but not free, and it partially undercuts the self-upgrade-safety claim in §7.1 for any step in flight at swap time. The fix is to carry Cursor's *3-way decoupling* (§2.1) into the step design: the sandbox/CLI job must have a lifecycle **independent of the portal request**. Pattern — a short `step.run` *dispatches* a detached sandbox job and returns its id; the workflow then `step.waitForEvent`s (or polls via `step.run` + `step.sleep`) on a completion signal. A portal recycle then re-attaches to the still-running job instead of restarting it. Confirm the current dispatch path's behaviour first: today the CLI runs inside the sandbox container but is driven by a portal-held exec stream, so portal death likely *does* kill the in-flight CLI — making "decouple the job lifecycle" a real work item in Phase 0/2, not a given.
- **HITL gates need bounded waits.** Suspending at a gate via `step.waitForEvent` requires a timeout and a defined timeout path (→ `awaiting-input` escalation, then `stale` via the watchdog). Wire the gate timeout into the same liveness contract (§5, principle 7) rather than letting a never-answered gate hang a run forever.
- **Concurrency moves to the engine.** Build admission control currently lives in the portal process. On Inngest it becomes a per-function `concurrency` key — simpler given single-org-per-install, but it must be set deliberately so a fan-out of specialist steps respects the same ceiling the in-portal loop enforced today.
- **Host memory remains a separate admission boundary.** Workflow concurrency limits how many logical steps may run; it cannot see the RAM retained by local inference, Docker, TypeScript, Vitest, or a Next build. Host-heavy steps therefore also claim the durable `host-heavy-resource` lane through `NonProductionEnvironmentLease`, declaring a closed resource class and expected memory floor. The host policy reserves memory for the operating system and resident inference, serializes inference, and fails closed when memory cannot be measured. A denied executor records queue evidence and exits instead of holding an idle Node process open. Inngest (or the invoking task) can retry or later resume from a lease event; the queue is durable state, not a population of waiting processes. See [`dpf-patterns.md` §1.6](dpf-patterns.md#16-host-heavy-work-uses-durable-resource-leases-not-waiting-processes) and the operations contract in [`local-ci-sandbox-slots.md`](../operations/local-ci-sandbox-slots.md).

### 7.6 Inngest as a concentrated platform dependency, and the versioning crux

§7.5 covers Inngest's *per-function* constraints; this covers the *system* consequence of putting build, campaign, and month-close on one self-hosted engine — and resolves the one place the doc still hand-waves: workflow versioning across self-upgrade. (Self-hosting facts independently verified 2026-06-09; cites §10.)

- **There is no native function versioning — so §8 Phase 2's "pin to a workflow version" is a pattern we build, not a toggle.** Self-hosted Inngest protects in-flight runs by *step-id memoization*, not version numbers: changing logic inside a step keeps in-flight runs safe, but renaming/reordering steps changes their replay. The documented way to ship a breaking change while runs are live is a **manual side-by-side** — a new function id gated by an event-version filter, old runs draining on the old function ([Inngest versioning](https://www.inngest.com/docs/learn/versioning)). Budget for building and operating that; it is the real content of "pin the version."
- **Concentration risk: the engine inherits the primary DB's blast radius.** DPF already backs Inngest with external Postgres + Redis (`INNGEST_POSTGRES_URI`/`INNGEST_REDIS_URI`), so run state survives an Inngest restart — the load-bearing property, and the reason this is viable at all. But it is a **single replica**, and its Postgres now holds the resume state for builds, campaigns, *and financial close*. An Inngest outage pauses every long-running process; loss of the inngest database strands every in-flight run. **It must inherit the same backup/restore, monitoring, and HA (multi-replica, which the external-store setup already permits) discipline as the main DB** before month-close — the workload least tolerant of a stall — moves onto it. Inngest publishes no support guarantee for self-hosted instances; this operational burden is ours.

**Open design question #1 — self-upgrade × determinism (the crux of Phase 2, currently unresolved).** Principle 10 wants "deploy without killing in-flight work," but self-upgrade recycles the portal with new code for *all* functions at once, and §7.5's "recovery = step granularity" already shows that a step in flight at swap time restarts. Two honest options: **(a)** quiescence drains *all* in-flight DAP runs before the swap — clean, but a multi-hour build blocks or is sacrificed by the upgrade; **(b)** the side-by-side pattern above — self-upgrade registers new function ids and lets old runs finish on the old code paths — true rainbow, but every DAP function carries version-routing and the post-swap portal must keep old code resolvable. Phase 2 must pick one deliberately; it is not a one-liner. Recommend a Phase-0 spike that kills the portal **mid-build** *and* **mid-self-upgrade** and observes resume empirically (per [`structural-verification-is-not-functional`](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md)).

---

## 8. Recommended sequencing

Each step below is a backlog item promoted through Build Studio in the normal way — this doc does not authorize code.

1. **Phase 0 — Spec + BI.** File a BI: "Move Build Studio orchestration onto Inngest durable execution." **Filed as `BI-89030C9B`** (epic `EP-BUILD-STUDIO`, status: triaging); it blocks the experience-layer item (`BI-BC8F667E`). Substrate-verify `TaskRun` extension (§7.4) **and** the Inngest constraints in §7.5 (step-output size limits, replay determinism of the current orchestrator control flow, stable step ids) — confirm the pinned Inngest version's actual limits before committing to the design. Smallest provable slice: wrap *one* phase (the build phase) as an Inngest function with per-task `step.run`, returning artifacts by reference, behind a flag, on a contained build. Prove resume-across-restart functionally on the live install (per [`structural-verification-is-not-functional`](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md)).
2. **Phase 1 — Retire the retrofits.** Once durable execution is proven for the build phase, delete title-match resume and the stranded/contradictory boot hooks; fix the silent dropped `taskResults` write as an idempotent step; add per-specialist timeout + circuit breakers.
3. **Phase 2 — Self-upgrade safety.** Resolve open design question #1 (§7.6): choose drain-all-before-swap vs. side-by-side function versioning, then implement it — there is no native "pin the version" toggle. Confirm a build survives a self-upgrade swap end-to-end, including a step in flight *at* swap time. Closes the self-upgrade-kills-in-session class.
4. **Phase 3 — Name the pattern.** Promote the assembled pattern to a `dpf-patterns.md` entry ("Durable Agentic Process") and a kernel principle ("long-running work runs on durable execution, never an in-process loop"). Extend `TaskRun` per §7.4.
5. **Phase 4 — Second instance: marketing campaign** as a DAP, reusing the now-named pattern. This is the real test of generality.
6. **Phase 5 — Third instance: monthly close** as a DAP, with idempotent posting + sign-off gate + compensation. Highest stakes, done last, on a proven pattern.
7. **Cross-cutting — observability.** Align the step journal/agent-event-bus emissions to OpenTelemetry GenAI conventions so every DAP is replayable and eval-able at each gate.
8. **Cross-cutting — experience layer.** Generalize the Build Studio progress-visibility components (process graph, operational panel, gate panel, stall-recovery, `TruthSourceBadge`, evidence timeline) into a `kind`-agnostic experience layer, and add a **cross-process inbox + notification transport** so `awaiting-input` and terminal states reach the operator without polling. The notification contract is **already designed** — the realtime-HITL-mobile-companion spec defines a canonical `HitlNotificationEvent` (`eventId`/`taskRunId`/`riskClass`/`title`/`summary`/`deepLink`) projected into `Notification` rows, a Paused-Work surface, push via `PushDeviceRegistration`, and authenticated approve/reject/request-changes endpoints (the audit confirms `TaskRun`/`Notification`/`agent-event-bus`/SSE already exist; only the canonical event, channel policy, and push delivery are unbuilt). A generalized DAP `awaiting-input` state should *emit that same event*, not invent a second path. Add in-UI plan editing (criterion 17). Sequence this *alongside* Phase 4 — the marketing instance is what proves the experience layer generalizes, not just the engine. The full UX design for this item — the notification *policy* that makes `riskClass` an alarm-fatigue-safe channel selector, situational-awareness gates, the cross-process inbox verb-set, re-entry digests, and the UX acceptance metrics to ship against — is in the companion [`2026-06-09-dap-experience-layer-design.md`](2026-06-09-dap-experience-layer-design.md). **Filed as `BI-BC8F667E`** (epic `EP-COWORKER-INTERACTIVITY`, status: triaging), with the Phase 1–2 notification slice (notification policy + `elicitation` activity type + situational-awareness gate) called out to land with the durable-execution migration rather than waiting for the marketing instance.

---

## 9. Decision B — execution-agent ownership and model economics

§1–§8 are **Decision A**: *how the process is orchestrated* (resilience + simplification). This section is **Decision B**, the orthogonal question raised in review: *do we own the development work, and can our own LLM cut cost?* The two are deliberately decoupled — and the central finding is that **Decision A is the precondition that makes Decision B a safe, reversible, per-task dial** rather than an architecture bet. Doing A does not commit us to any model choice; it gives us the seam to change model per step without re-plumbing.

### 9.1 Two sub-decisions, kept separate

- **B1 — ownership of the dev agent.** Keep *renting* it (the Codex/Claude/Grok CLI). The durable layer (A) does **not** rebuild or mirror what the CLI does: the CLI invocation is the *body* of a `step.run`. Nothing the CLI does is re-implemented in our code. This is exactly Cursor's split (durable loop on the engine; tool execution dispatched out to the worker).
- **B2 — model economics.** How to control `$/task` given (a) a shifting vendor pricing model, (b) routing infrastructure we already own but don't use, and (c) a quality gap that makes the orchestrator frontier-only.

### 9.2 What the code does today (verified 2026-06-09)

- **Single fixed global model, not per-task.** `getBuildStudioConfig()` ([`build-studio-config.ts:88`](../../apps/web/lib/build/build-studio-config.ts)) returns one provider/model per install (`claude`/`codex`/`grok`/`agentic`); every specialist in a build uses it. `SPECIALIST_MODEL_REQS` declares per-role tiers (DA/SE/FE → `frontier`, QA → `strong`) but the **CLI path ignores them** and uses the global pick.
- **CLI path is default and rides the subscription.** Claude dispatch defaults to OAuth Max-plan auth (`anthropic-sub`); the code comment itself notes API-key mode burns "**$100 in a few hours vs. 5+ days on Max Plan**" ([`claude-dispatch.ts:8,39`](../../apps/web/lib/build/claude-dispatch.ts)). Codex uses ChatGPT-subscription OAuth.
- **The routing brain exists but Build Studio doesn't use it.** Quality tiers, `cost-ranking.ts` (`rankByCostPerSuccess`), per-agent `AgentModelConfig`, and an **Ollama/Docker-Model-Runner adapter with free pricing** are all present in `lib/routing/*` — but only the *agentic-loop fallback* path routes through them. The CLI path does not.
- **The CLI path cannot use a local model.** Both `codex` and `claude` runners set `honorsLlmBaseUrl: false`; only the `provider === "agentic"` fallback can target `LLM_BASE_URL`. So "use our own LLM" today means leaving the CLI, not configuring it.
- **No `$/build` accounting.** `FeatureBuild` has no cost/token fields; the CLI path returns no token counts. `ToolExecution.costUsd` exists ([`ai-coworker.prisma`](../../packages/db/prisma/schema/ai-coworker.prisma)) but isn't populated for specialist runs. **We cannot measure what a build costs today** — a prerequisite gap for any optimization.

### 9.3 The pricing premise is shifting under us (the decision-changer)

The "CLI on a flat subscription is ~5–20× cheaper than per-token API" advantage is real for *interactive* coding — but **Anthropic has moved programmatic/headless use (`claude -p`, the Agent SDK, CI actions) onto per-token billing** (reported cutover 2026-06-15; the *mechanism* is confirmed from the primary source, the exact date is not — §9.7); the subscription contributes only a fixed monthly dollar credit (~$200 on Max 20×) that drains at API rates and then stops ([Anthropic Agent SDK billing](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), observed 2026-06-09). Build Studio's dispatch is automated, headless CLI-in-a-sandbox — squarely the *programmatic* bucket. So for an *automated* build agent, a $200 Max seat is economically a **$200 spend cap, not all-you-can-eat**.

The implication is the opposite of "lock in the subscription": **the flat-rate advantage for automated Build Studio has a shelf life, which argues for making the model a routable dial (what A enables) rather than betting the architecture on subscription economics staying cheap.** This is the platform's own [`no-provider-pinning`](../founder-kernel/wiki/principles/no-provider-pinning.md) principle meeting a market reason to honor it.

### 9.4 Can our own LLM cut costs significantly? Honest answer: partially.

- **Quality gap (June 2026).** Best open weights (DeepSeek V4-Pro, Kimi K2.6, GLM-5.1, MiniMax M3) sit roughly **5–15 points behind frontier on single-shot coding benchmarks** — the exact figure is benchmark-sensitive and noisy (SWE-bench Verified vs Pro vs LiveCodeBench disagree, contamination is a known confound, and a few open models post near-parity on individual suites), so treat any single number as directional, not load-bearing. The gap that *actually* matters for Build Studio is wider and more stable: long-horizon agentic benchmarks (Terminal-Bench-class) show a larger deficit, and weaker models **degrade on long-horizon agentic loops — the threshold is workload-specific and must be measured per task class, not assumed** (§9.7) — exactly the regime of Build Studio's design-review→iterate→ship loop. The strategic conclusion is robust to the benchmark noise: *Orchestrator, design-review, hard-bug, novel-architecture work = frontier-only.* *Leaf tasks — test-writing, scoped single/multi-file edits, structured integration, extraction/classification = safely offloadable.*
- **Self-hosting GPU does not pay at our volume.** Breakeven vs cheap open-model APIs is ~100–200M tokens/day at >60% utilization; below that, the open models' own **APIs** (e.g. DeepSeek V4-Flash ≈ $0.14/$0.28 per Mtok) beat owning 8×B200 *and* skip the ops burden. Bursty build traffic is the worst case for GPU utilization. **Do not self-host yet.**
- **The hidden rework tax.** A weaker model on long-horizon loops burns ~2–3× the tokens and extra full iterations, or fails the gate outright — so "near-zero marginal cost" can cost *more* total. For orchestrator work the cost gap and the quality gap point the same way.
- **Hybrid is the real lever, on the leaf slice only.** Routing easy tasks to cheap/open models saves a reported 40–70% — but only on that slice; Build Studio's signature orchestration loop stays frontier.

### 9.5 Cost bands (order of magnitude, mid-2026; full cites §10)

| Lever | Number that matters |
|---|---|
| Frontier agentic task, uncached | ~$3–$6/task (Sonnet/Opus/GPT-5.5 tier); median ≈ 1M input + 40K output |
| **Prompt caching** (the #1 lever) | cache reads = **0.1× input** (90% off) → ~3–5× cheaper/task; input dominates 25:1 |
| Automated 50–200 tasks/day on frontier API | **~$2K–$26K/mo** depending on tier + caching |
| Cheap open-model API (DeepSeek-class) | ~10× cheaper than Sonnet per token — the leaf-task target |
| Self-hosted GPU (big-MoE coding) | ~$35K–$50K/mo at 24/7 for V4-Pro on 8×B200 — only sane >100–200M tok/day |
| Token variance per task | budget for **~30×** spread; more tokens ≠ better |

### 9.6 Recommendation

- **B1 — keep renting the CLI.** We can't out-engineer frontier dev agents, harness quality swings results up to 6×, and the CLI is a good harness. Don't rebuild it.
- **B2 — sequence, don't bet:**
  1. **Do A first.** It turns the per-task model into a routable dial and is provider-agnostic — the structural hedge against the §9.3 subscription erosion.
  2. **Instrument `$/build`** (token + cost per phase/task) as part of A's Phase 0. We cannot optimize what we cannot measure, and §9.2 shows we can't measure it today.
  3. **Wire Build Studio into the existing capability-tier routing** (it's built, just unused): frontier for DA/SE/FE/orchestrator + design-review; a cheaper tier for QA and clearly-leaf tasks.
  4. **Exploit prompt caching aggressively** — the single biggest cost lever (cache reads = **0.1× input, 90% off**, confirmed 2026-06-09), and it lands cleanly once steps return artifacts by reference (§7.5). One Build-Studio-specific gotcha: the default cache TTL is **5 minutes**; a build's specialist dispatches are spread across ~40 min with gaps, so a naive cache expires *between* steps and the discount never materializes. Capturing it means either the **1-hour cache window** (cache-write costs 2× instead of the 5-min 1.25×, still a large net win for a long build) or structuring same-prefix dispatches to land inside the TTL. "Turn on caching" is not enough — the cache lifetime has to be matched to the process's step cadence.
  5. **Offload only clearly-leaf tasks** to cheap open-model **APIs**, then re-measure. Keep the orchestrator frontier.
  6. **Do not self-host GPU** at current volume; revisit only past ~100–200M tok/day or under a data-sovereignty mandate.

**Net:** A and B compose. A is the seam; B is a measured tuning exercise on top of it — reversible per task, and hedged against a vendor pricing model that is already moving against flat-rate automation. Nothing in B requires "owning the entire process" or mirroring the CLI's work in our code.

### 9.7 Epistemic status of the §9 numbers (independent verification, 2026-06-09)

§9's market figures were spot-checked against live sources. They are directionally sound and the §9.6 recommendation is unchanged — but three are overstated or unsupported and must be softened before any spend decision leans on them. Recorded here so the BI inherits the caveats, not just the headline numbers.

- **Confirmed as stated:** Claude pricing (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, cache reads 0.1×); the Agent-SDK billing *mechanism* (subscription = fixed monthly credit that drains at API rates, then requests stop); DeepSeek V4-Flash $0.14/$0.28; hybrid-routing 40–70% savings; all three named open models (DeepSeek V4-Pro, Kimi K2.6, GLM-5.1) are real; arXiv 2604.22750 is a real paper and its **30× token-variance** figure is genuine.
- **Soften — conflated benchmark:** "~8 points behind on **SWE-bench Verified**" is actually the SWE-bench **Pro** gap; on *Verified* the live mid-2026 open-vs-frontier gap is ~0–4 points (near-parity). The *frontier-only orchestrator / offload-leaf-tasks* conclusion still holds — but on the **long-horizon (Terminal-Bench)** axis, which is the relevant one; cite that, not Verified.
- **Correct — unsupported number:** "**lose coherence past ~3–4 step agent loops**" is not supported by any source and contradicts the advertised multi-thousand-step capabilities of the very models named. The defensible claim is: *weaker models degrade on long-horizon agentic loops; the threshold is workload-specific — measure per task class, do not assume a fixed step count.*
- **Attribution fix:** "$3–6/task," "median 1M input / 40K output," and "25:1 input:output" are **not** findings of arXiv 2604.22750 — they are derived/secondary estimates. Keep them as this doc's own order-of-magnitude inference, not paper-attributed.
- **Date/precision caveats:** the specific "2026-06-15" Agent-SDK cutover date could not be confirmed from the primary source (the mechanism could); GPT-5.5's *list* price doubled, but realized cost rose ~49–92%, not a flat 2×; the self-host breakeven source models a single A100, not 8×B200 (the ~100–200M tok/day order of magnitude still holds; live figure ~190–230M).

---

## 10. References (primary sources, dated)

**Cursor**
- "What we've learned building cloud agents" — https://cursor.com/blog/cloud-agent-lessons (2026-06-02) — Temporal durable execution, 3-way decoupling, checkpoint/restore/fork, 50M actions/day.
- "Run cloud agents in your own infrastructure" — https://cursor.com/blog/self-hosted-cloud-agents (2026-03-25) — split inference/execution, isolated per-agent machines.
- Cloud Agents docs — https://cursor.com/docs/cloud-agent ; Plan Mode — https://cursor.com/docs/agent/plan-mode ; Checkpoints — https://docs.cursor.com/en/agent/chat/checkpoints
- Cursor 2.0 — https://cursor.com/blog/2-0 and https://cursor.com/changelog/2-0 (2025-10-29) — 8 parallel worktree-isolated agents, native review.

**Linear**
- Agent Interaction docs — https://linear.app/developers/agent-interaction ; Getting Started (agents) — https://linear.app/developers/agents — `AgentSession`, six-state machine, five activity types, delegate-not-assignee, 5s/10s liveness.
- "Our approach to building the Agent Interaction SDK" — https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk (2025-08-01).
- Agent Interaction Guidelines and SDK changelog — https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk (2025-07-30).
- "How we use Linear Agent at Linear" — https://linear.app/now/how-we-use-linear-agent-at-linear (2026-04-10) — human-in-loop merge gate, task decomposition.

**Anthropic**
- "Building Effective Agents" — https://www.anthropic.com/research/building-effective-agents (2024-12) — workflows vs agents, five patterns, start simple.
- "Effective context engineering for AI agents" — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — compaction, note-taking, sub-agent isolation, JIT retrieval.
- Multi-agent research system — https://www.anthropic.com/engineering/multi-agent-research-system — resumable execution + checkpoints + retry, rainbow deployments, orchestrator-workers.

**Durable execution & orchestration**
- Temporal + OpenAI Agents SDK — https://www.infoq.com/news/2025/09/temporal-aiagent/ (2025-09-18).
- Restate durable agents — https://docs.restate.dev/ai/patterns/durable-agents ; suspend/resume + HITL.
- DBOS lightweight durable execution — https://www.dbos.dev/blog/what-is-lightweight-durable-execution.
- AWS Lambda Durable Functions — https://aws.amazon.com/blogs/aws/build-multi-step-applications-and-ai-workflows-with-aws-lambda-durable-functions/ (2025-12).
- Cloudflare Workflows GA / V2 — https://blog.cloudflare.com/workflows-ga-production-ready-durable-execution/ ; https://www.infoq.com/news/2026/05/cloudflare-workflows-v2-release/.
- Inngest AI / AgentKit — https://www.inngest.com/ai ; https://agentkit.inngest.com/.
- Inngest self-hosting, versioning, limits & `waitForEvent` (verified 2026-06-09 for §7.5/§7.6) — https://www.inngest.com/docs/self-hosting ; https://www.inngest.com/docs/learn/versioning (no native function versioning; manual side-by-side) ; https://www.inngest.com/docs/usage-limits/inngest (4MB/step, 32MB/run, 1000 steps/fn, 2h/step) ; https://www.inngest.com/docs/reference/functions/step-wait-for-event ; https://github.com/inngest/inngest-helm (external Postgres+Redis for HA).
- Inngest usage limits (4MB/step output, 32MB/run-state, 1000 steps/function, ≤2h/step, `step.sleep` ≤1yr; confirmed 2026-06-09) — https://www.inngest.com/docs/usage-limits/inngest ; durable-execution / HTTP-per-step model — https://www.inngest.com/docs/learn/how-functions-are-executed ; Next.js timeout decoupling — https://www.inngest.com/blog/how-to-solve-nextjs-timeouts.
- Trigger.dev waitpoints / HITL — https://trigger.dev/product/ai-agents.
- LangGraph durable execution + `interrupt`/`Command` — https://docs.langchain.com/oss/python/langgraph/durable-execution.
- Deterministic AI orchestration ("agents shouldn't decide what comes next or where artifacts live") — https://www.praetorian.com/blog/deterministic-ai-orchestration-a-platform-architecture-for-autonomous-development/.
- Saga pattern — https://microservices.io/patterns/data/saga.html ; https://temporal.io/blog/mastering-saga-patterns-for-distributed-transactions-in-microservices.
- OpenTelemetry GenAI observability — https://opentelemetry.io/blog/2025/ai-agent-observability/.

**Model economics (Decision B) — all observed 2026-06-09, fast-moving**
- Anthropic Agent SDK billing split (programmatic use bills per-token from 2026-06-15; subscription = fixed credit) — https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan.
- Claude pricing (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15; cache reads 0.1×; +35% tokenizer note) — https://platform.claude.com/docs/en/about-claude/pricing ; plans — https://claude.com/pricing.
- OpenAI Codex pricing + Apr 2026 per-token credit metering — https://developers.openai.com/codex/pricing ; GPT-5.5 price doubling — https://openrouter.ai/announcements/gpt55-cost-analysis.
- Agentic task token consumption — arXiv 2604.22750, https://arxiv.org/abs/2604.22750 (**30× per-task token variance** is the paper's finding; the ~1M–3.5M tokens/task, median 1M-input/40K-output, and 25:1 input:output figures are this doc's derived order-of-magnitude estimates, not paper-attributed — §9.7).
- Open-weight coding quality / SWE-bench Verified + Terminal-Bench leaderboards (June 2026) — https://kilo.ai/open-source-models ; https://benchlm.ai/benchmarks/terminalBench2 ; SWE-bench contamination — https://www.codeant.ai/blogs/swe-bench-scores.
- Self-hosting vs API cost & breakeven — https://devtk.ai/en/blog/self-hosting-llm-vs-api-cost-2026/ ; https://aisuperior.com/llm-hosting-cost/ ; hybrid routing savings — https://www.sitepoint.com/hybrid-cloudlocal-llm-the-complete-architecture-guide-2026/.

**Experience / HCI**
- Nielsen Norman Group, "10 Usability Heuristics for User Interface Design" (#1: *visibility of system status*; #5: *error prevention*) — https://www.nngroup.com/articles/ten-usability-heuristics/.
- Jakob Nielsen, "Response Times: The 3 Important Limits" (0.1s / 1s / 10s — beyond 10s the user needs progress feedback and the ability to do something else) — https://www.nngroup.com/articles/response-times-3-important-limits/.
- Nielsen Norman Group, "Progress Indicators Make a Slow System Less Insufferable" — https://www.nngroup.com/articles/progress-indicators/.
- DPF internal — realtime HITL mobile companion: design + readiness audit — [`docs/superpowers/specs/2026-05-13-realtime-hitl-mobile-companion-design.md`](../superpowers/specs/2026-05-13-realtime-hitl-mobile-companion-design.md), [`readiness report`](../superpowers/audits/2026-05-13-realtime-hitl-mobile-readiness-report.md).

---

*This is an assessment. Every recommendation in §7–§8 enters the backlog and is promoted through Build Studio; nothing here is authorization to write feature code directly.*
