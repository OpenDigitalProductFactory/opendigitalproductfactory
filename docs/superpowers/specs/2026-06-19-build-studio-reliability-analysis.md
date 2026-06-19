# Build Studio Reliability — Research Pass & Design-Improvement Roadmap

- **Status:** Analysis / recommendations (not yet ratified). Feeds EP-9FC5D2FD (Build Studio first-customer hardening).
- **Date:** 2026-06-19
- **Method:** three parallel code audits (pipeline map, per-LLM-call/prompt inventory, failure-mode + fix-churn analysis) cross-validated against **empirical build history on the live install** and the recent git fix-churn. Every claim carries a `file:line` or a DB number.
- **Framing:** the operator's words — *"death by a thousand cuts."* This pass finds that the thousand cuts are **four root failure families** re-surfacing in different shapes, each historically patched narrowly.

---

## 1. The reality, quantified (live install, `BuildDispatchAttempt` + `FeatureBuild`)

| Signal | Value | Source |
|---|---|---|
| Builds that **completed** | **5 / 39 (13%)** | `FeatureBuild.phase` |
| Builds **abandoned** | 24 / 39 (62%) (`abandonedAt` set) | `FeatureBuild` |
| Builds **failed** | 9 / 39 (23%) | `FeatureBuild.phase='failed'` |
| Dispatch failure rate | **19 / 67 (28%)** | `BuildDispatchAttempt` |
| Dominant failure axis | **`usage-limit` = 17/19 (89%)** | `BuildDispatchAttempt.failureAxis` |
| usage-limit source | **`chatgpt` (Codex CLI, cloud) — one build fired ~17 dead dispatches** into an exhausted ChatGPT/Codex subscription cap | rootCauseSummary |
| Local coder result | **`qwen3-coder` 8/8 success, 0 failures** | dispatch attempts |
| Local embedding footgun | `nomic-embed-text` 2 failures (qa + software specialists) | dispatch attempts |
| **Plan phase latency** | **avg 2,242 s (~37 min), max 15,247 s (4.2 hours)** | `BuildPhaseRun` |
| Ideate phase latency | avg 158 s, max 1,583 s (26 min) | `BuildPhaseRun` |

Read-through: **~87% of builds never shipped.** The single largest *dispatch* killer was a cloud subscription cap, against which the orchestrator had no fast-abort — it kept firing the same doomed dispatch ~17 times. The local coder path, by contrast, has a clean record once configured. The plan phase is a multi-hour latency sink.

---

## 2. The four root failure families

Each family is cross-validated by (code) a `file:line` root cause, (churn) the recent commits that keep patching it, and (data) the empirical signal above.

### Family 1 — No verification → fix loop (the biggest architectural gap)
Verification failures **stall** the build; they are never fed back to a coding agent to repair.
- Pipeline records test failures but **does not fail the step** and sets `testsFailed` to a coarse `1`, assuming the agentic loop already fixed them — `apps/web/lib/integrate/build-pipeline.ts:555,569-572`.
- Typecheck gate **blocks build→review with no remediation dispatch** — the build just sits.
- Orchestrator: any `BLOCKED`/`NEEDS_CONTEXT` specialist halts auto-advance with no fix attempt — `apps/web/lib/integrate/build-orchestrator.ts:1436-1447`.
- The only repair that exists is *within* one agentic-loop invocation; there is no **cross-step** repair.
- **Churn:** the hottest surface — `#2019/#2020/#2023` all scope the build→review gate so unrelated/whole-repo failures stop blocking every build. Because the scoping is regex-on-output (Family 4), it keeps churning.
- **Shipped (the plan-review sub-case, the live root cause of the WIP jam):** plan review used to **fail and leave the rejected plan saved**, so the idempotency guard blocked regeneration and every reboot's `resumeStrandedBuildsOnBoot` re-failed it forever. `#2090` (BI-99B06AD1) closes the loop — feed the reviewer's blocking issues back into a bounded plan revision (`PLAN_FIX_MAX_ROUNDS`), re-review, then **escalate** instead of churning. When even the bounded loop can't pass, BI-3E0EE3BA (§5) captures it for a human and frees the WIP slot.
- **Shipped (the build/codegen sub-case — P0.1, this family's core):** the orchestrator used to stall at the build→review gate whenever the build's own changed surface failed typecheck/tests, with no cross-step repair. `runVerificationRepairLoop` (`apps/web/lib/build/verification-repair.ts`), wired into the orchestrator after the scoped verification save, now dispatches a **scoped repair coding turn** (failing files ∩ changed surface + the real error text), **re-verifies directly via `runSandboxTests`** (no extra LLM), and repeats up to `VERIFICATION_REPAIR_MAX_ROUNDS` (default 2) before falling through to the existing gate. Additive + bounded + behind the orchestrator's existing try/catch — regression-safe. Pure prompt/selection helpers + the injected-deps loop are unit-tested.

### Family 2 — Cloud usage-limits with no fast-abort, failover, or resumable pause
- Empirically the #1 dispatch killer: 17 dead `chatgpt` dispatches in one build, each returning *"You've hit your usage limit"*, none aborting the storm.
- The CLI dispatch path maps a non-zero exit straight to `BLOCKED` with **zero per-task retry/backoff or axis-aware handling** — `build-orchestrator.ts:823-837,578-579`.
- There is no "this whole provider is capped → stop dispatching / switch the build to local / pause until reset" logic. Local-only mode (`#2004`) *removed the cloud safety net*, so on a mixed install a cap is fatal rather than degraded.
- **Shipped (the fast-abort, BI-F72C1044):** the orchestrator runs the whole build on ONE configured provider, so the first `usage-limit` dispatch means every remaining one will fail identically. `build-orchestrator.ts` now detects it (`isUsageLimitDispatchOutput`, reusing `classifyDispatchFailureAxis` so the vocabulary stays single-sourced), **stops dispatching** the rest of the phase + skips remaining phases, leaves the un-dispatched tasks pending for a retry once the cap resets, and surfaces a "provider hit its usage limit" phase summary — killing the "~17 dead dispatches" storm. *Remaining (the degrade/failover half):* automatic switch-to-local or pause-until-reset is a deliberate follow-up; this slice stops the waste.

### Family 3 — Single-GPU local concurrency + inconsistent timeouts (the latency sink)
- **Four independent timeout layers that don't compose:** local HTTP `LOCAL_INFERENCE_TIMEOUT_MS=60_000` (`apps/web/lib/routing/chat-adapter.ts:36-37`) vs agentic wall-clocks (build 10 min, **default 2 min**, `apps/web/lib/tak/agentic-loop.ts:41-45,1179-1184`) vs CLI dispatch (15–40 min, `*-dispatch.ts`) vs orchestrator 40 min (`build-orchestrator.ts:50`). The 60 s local HTTP cap is shorter than a cold qwen load + long generation, and on local-only there is no fallback.
- **`withLocalInferenceLock` (`#2009`) only serializes the in-process HTTP path.** The sandbox-CLI path (`build-orchestrator.ts:793-822`) runs the model *inside the container* and **bypasses the lock**, so two parallel sandbox specialists still collide on one GPU. Background dimension evals pile onto the same GPU (`#2046/#2047`).
  - **Shipped (BI-0F291741, the sandbox-CLI GPU collision):** the orchestrator's specialist dispatch concurrency is now provider-aware — `MAX_CONCURRENT_TASKS = 1` when the build engine is local (`opencode`), `2` for cloud subscription CLIs. A local build serializes its specialists so they no longer collide on the single GPU (the "both reviewers timed out" failure, now in the build phase), while cloud keeps its throughput within per-minute caps. (The in-process timeout is also already env-tunable — `DPF_LOCAL_INFERENCE_TIMEOUT_MS`, default 120s — not the stale 60s. *Remaining:* the 4-layer timeout reconciliation + local-first routing are a deliberate follow-up.)
- Symptom in data: **plan phase avg 37 min / max 4.2 h.**
- **Local agentic path is unusable by construction:** the loop abandons after **8 tool calls** when `providerId==='local'` (`agentic-loop.ts:1197-1208`), and the pipeline hard-codes `taskType:'analysis'`+`requireTools:true` to force API tool-calling (`build-pipeline.ts:486,496-501`). Only `opencode` makes local builds work — so it must be the *first-class* local path, not a branch.

### Family 4 — Output fragility on local models (no structured-output contract)
- Strict parsing everywhere: ideate `repairJson` only fixes trailing commas + unescaped quotes (`apps/web/lib/integrate/ideate-dispatch.ts:260-308`); plan parsing validates only array presence with 2 attempts (`apps/web/lib/integrate/plan-on-approval.ts:125-155,269`); code-gen uses a strict `### FILE:` regex with **no fallback** (`apps/web/lib/integrate/coding-agent.ts:512`).
- CLI dispatch treats `exitCode===0` as success and takes raw stdout — a model that exits 0 with garbage is recorded `DONE` (`build-orchestrator.ts:823-828`).
- Failure axis is inferred by **substring-matching output text** (`apps/web/lib/build/verification-output.ts:45-73`, truncated to 2000 chars) — brittle and the reason Family 1's gate scoping keeps churning.
- The **embedding-model footgun** (2 live failures) is the concrete instance; partially fixed by `pickDefaultCodingModel` + the new Build Runtime warning/pin (`#2004`), but `resolve_model_selection` still flags served-list ordering.

### Supporting cuts (real, lower-frequency)
- **Watchdog/heartbeat blind spots:** TaskRuns in `quiescing`/`input-required`/`auth-required` emit no heartbeat and aren't watched (`apps/web/lib/queue/functions/taskrun-watchdog.ts`); dead-phase reaping is **feature-flagged OFF** (`QUIESCENCE_REAP_DEAD_PHASES`, `apps/web/lib/self-upgrade/quiescence.ts`). Churn: `#2022/#2026/#2032`.
- **Sandbox node_modules drift:** `pnpm install --frozen-lockfile` falls back to plain install on *any* error, silently changing the dep tree; preflight (`#2021`) heals only *unloadable* node_modules, not *stale-but-loadable*. Recurring across sessions.
- **Self-upgrade swap mid-build** orphaned checkpoints (`#2010`); **slot pool** resets `in_use`→`available` on restart with no lease/epoch (slot races / leaks), 30-min blind queue wait (`apps/web/lib/integrate/sandbox/sandbox-pool.ts`, `build-pipeline.ts:270-277`).
- **UI-click unreliability:** an abandon reason on the live install was *"approve-start UI click unreliable."*

---

## 3. Prioritized improvement roadmap

Ordered by leverage (impact on the 13% completion rate × breadth of churn absorbed).

### P0 — architectural, highest ROI
1. **Verification → bounded fix loop.** On typecheck/test failure, dispatch a scoped repair turn (the failing files + the real error) back to the coding agent, up to N bounded iterations, before stalling. Replaces "stall + wait for human." Absorbs most of Family 1's recurring gate churn. *Files:* `build-pipeline.ts`, `build-orchestrator.ts`, `build/scoped-verification.ts`, `build/verification-output.ts`.
2. **Usage-limit fast-abort + failover + resumable pause.** Detect the `usage-limit` axis on the *first* hit; immediately stop dispatching to the capped provider; either (a) fail the build over to the local engine (now viable) or (b) pause-and-resume when the cap resets. Kills the "17 dead dispatches" pattern. *Files:* `build-orchestrator.ts` dispatch loop, `*-dispatch.ts`, `routing/`.
3. **Make `opencode`/local the first-class build path + one GPU-sized inference gate for ALL local calls.** Route both the in-process HTTP path *and* the sandbox-CLI path through a single concurrency gate sized to GPU count; reconcile the four timeout layers (raise/remove the 60 s local HTTP cap; one coherent budget per phase). Removes usage-limits entirely and fixes the plan-phase latency. *Files:* `chat-adapter.ts` (`withLocalInferenceLock`), `build-orchestrator.ts`, `*-dispatch.ts`, `agentic-loop.ts:41-45,1179-1208`.

### P1 — robustness
4. **Structured-output contract for ideate/plan/codegen.** Schema-validate parsed output; detect truncation pre-parse; retry with the validation error as a hint; add a loose-format fallback for code-gen; keep the embedding guard. *Files:* `ideate-dispatch.ts`, `plan-on-approval.ts`, `coding-agent.ts`, `propose-decomposition.ts`.
5. **Right-size context to the model's real window.** Read `maxContextTokens` from the endpoint manifest; set the agentic history cap + injected-context budget dynamically (an 8K-window local model must truncate sooner than a 32K one). *Files:* `agentic-loop.ts:46-47`, `build-pipeline.ts:357-405`.
6. **Close watchdog/heartbeat blind spots + flip dead-phase reaping ON by default.** Cover `quiescing`/`input-required`/`auth-required`; default `QUIESCENCE_REAP_DEAD_PHASES=1`. *Files:* `taskrun-watchdog.ts`, `observability/heartbeat.ts`, `self-upgrade/quiescence.ts`.
   - **Shipped (BI-8F45BA74):** dead-phase reaping is now **always-on, no flag** (`quiescence.ts` `DEAD_PHASE_LIVENESS_MS`, a corpse phase is dropped from the drain blockers + closed). And the `quiescing` blind spot is closed: `recoverStuckQuiescingTaskRuns` (`taskrun-watchdog.ts`, every tick) reaps a TaskRun stranded in `quiescing` past the 15-min liveness window — a loop that died mid-drain and never cooperatively exited to `paused-for-upgrade` — transitioning it to `stalled` (surfaced + retryable) instead of silently-lost limbo. Observed live 2026-06-19: 32 such rows survived a swap+reboot. *Remaining:* `input-required`/`auth-required` parked-state policy (riskier — a real wait must not be reaped) is a deliberate follow-up.

### P2 — durability & latency
7. **Content-hash/pin the sandbox node_modules** so "stale-but-loadable" is detected, not just "unloadable." *Files:* `integrate/sandbox/sandbox.ts`.
8. **Durable orchestrator sub-steps + slot lease/epoch.** Break the single `pipeline:implement` durable step into per-batch sub-steps (resume mid-build); give sandbox slots a lease/epoch so restarts don't race or leak. *Files:* `queue/functions/build-execute.ts`, `integrate/sandbox/sandbox-pool.ts`.
9. **Investigate the 37-min plan phase directly** (model right-sizing for the reasoning tier, prompt trimming, or splitting plan generation) — it is the worst single latency sink.

---

## 4. Appendix — artifact pointers
- **Pipeline map** (phase-by-phase entry points, durable vs inline, gates): ideate (`integrate/ideate-dispatch.ts`, `actions/build.ts`), plan (`integrate/plan-on-approval.ts`), reviews (`integrate/build-reviewers.ts`, `prompts/reviewer/*.prompt.md`), build (`queue/functions/build-execute.ts` → `integrate/build-orchestrator.ts` / `integrate/build-pipeline.ts`), review-verify (`queue/functions/build-review-verification.ts`), ship (`actions/build.ts`). Two execution paths exist (pipeline single-task vs orchestrator specialist-fan-out) with divergent timeouts/retries/parse logic — a recurring "works one way, breaks the other" source.
- **LLM call inventory** (prompt source + routeAndCall config + parse fragility) for ideate / plan / decomposition / design-review / plan-review / code-gen / compaction / utility: see §2 Family 4 refs.
- **Data model:** `FeatureBuild`, `BuildPhaseRun`, `BuildDispatchAttempt` (`packages/db/prisma/schema.prisma`).

---

## 5. When Build Studio can't fix itself — capture, escalate, learn, route

Automating the *removal* of a stuck build (the inert-build reaper, `#2081`) only clears the symptom. A recursively self-improving platform sometimes **cannot fix itself "for obvious reasons"**: the defect is in the dispatch path it runs on, the change is beyond the local model, or it needs capability/expertise the install does not have. Recognizing "I can't fix this" is a first-class, *learnable* outcome — not a failure to suppress. Operator direction (Mark, 2026-06-19).

**The four obligations** when a unit of work exhausts self-repair:
1. **Capture** a durable escalation record — root cause, what was attempted, why blocked, and a **self-fix-feasibility class**: `auto-recoverable | needs-human | needs-external-capability`.
2. **Raise** it to humans as an actionable "needs human" item, distinct from auto-recoverable stalls, with the originating work **never silently lost**.
3. **Feed the hive/commons** the failure *signature* + resolution, so the network learns its own limits and later installs get a known path (`learnings-belong-in-the-shared-commons`).
4. **Route to a support tier** — customer self-service → **reseller/partner augmentation** (scoped, time-boxed grant to augment a customer who lacks the dev capability/expertise/tools) → upstream/DPF. DPF-as-conduit, sovereignty-aware.

**Shipped now (BI-3E0EE3BA, plan-review sub-case).** On bounded-fix-loop exhaustion, `escalateBuildToHuman()` (`apps/web/lib/build/escalate-build-to-human.ts`), called from `plan-on-approval.ts`, reuses existing substrate rather than adding new machinery:
- **Capture + raise** via `createPlatformIssueReport()` (`type:"build-stall-escalation"`, build-linked, deduped) — its OPEN rows **auto-project into the backlog/triage intake** (EP-INTAKE-UNIFY), so the escalation surfaces with no new notification plumbing.
- **Free WIP** by marking the build `abandoned` (the WIP cap counts only `abandonedAt`-null builds) — clearing the jam.
- **Re-queue without re-stalling** by parking the originating backlog item as **`deferred`** (not `open`, which would auto-re-promote into the same stall) and detaching the build.
- The one genuinely-new field is `PlatformIssueReport.selfFixClass`, the feasibility class consumed downstream.

**Shipped now (BI-3E0EE3BA, the dead-on-arrival source).** The live "15 builds stuck at the ideate gate with zero activity" jam had a precise cause: the governed backlog tee-up **auto-approves** an eligible draft (`draftApprovedAt` set, `autoApprovedDispatchEligible: true`) but the **only** caller that fired `dispatchIdeateForApprovedBuild` was the operator's "Approve Start" UI click — which an auto-promoted build never receives, so the flag was never read and the draft sat in `ideate` with no designDoc forever (and the inert-build reaper won't touch it: the auto-approve wrote an `approve_start` activity, so it isn't "inert"). `dispatchApprovedIdeateBuilds()` (`ideate-on-approval.ts`), called from both governed-tee-up queue functions after promotion, finds every approved draft still missing a designDoc (pure `buildNeedsIdeateDispatch`, mirroring the dispatch idempotency guard) and fires the idempotent, never-throwing dispatch — bounded per run. One pass **clears the existing DOA builds AND completes the autopilot** for newly-promoted ones. *(Empty-body items remain operator-driven by existing design; an empty-body auto-promotion policy is a possible follow-up but was out of scope to avoid changing the established selection contract.)*

**Roadmap (the rest of the dimension):**
- **BI-76B4317F** — hive learning of self-fix-limit **signatures**: contribute the `(failure signature → resolution, feasibility class)` to the commons so repeated limits become known paths.
- **BI-5090F4AA** — **tiered support + reseller/partner augmentation** (`EP-PARTNER-CHANNEL`): route `needs-external-capability` escalations to a scoped, time-boxed partner grant; `needs-human` to the operator; `auto-recoverable` stays in-loop.
- **UI:** a dedicated "Needs human" panel filtering `build-stall-escalation` reports by `selfFixClass` (the data + intake projection already exist; surfacing is the remaining slice).
