---
status: active
---

# Plan — Engine-aware inference admission budget

Date: 2026-07-07. Epic: EP-B9DD37C7 (coworker trust/transparency) · relates to
EP-056D2A5E (concurrency & contention). Follows BI-3F09BDD4 (Proactivity →
autonomous scheduled self-tasks, shipped #2674 + fabrication fix #2685).

## Why

Operating the autonomous self-task substrate surfaced a scaling constraint: as
more coworkers self-drive, every scheduled + build + interactive turn eventually
funnels through the **same** inference engine. A local model (Docker Model
Runner, 7–13B class) reliably handles ~1–2 concurrent requests before latency
collapses; an external provider is bounded by its rate limit and by cost.

## Substrate finding (dpf-verify-substrate-first)

What already bounds load:

- `agent/task-dispatch` (`apps/web/lib/queue/functions/agent-task-dispatch.ts`)
  runs as a **single-concurrency** Inngest function and drains due tasks
  **serially** (`for … await`), capped at `take: 20` per 5-min tick, enrolled in
  the shared build-pipeline lane (`admission.ts`), gated by quiescence.
- Self-tasks are spread across ticks by `deconflictCron`.

The gap: those protections are **Inngest-only**. Interactive coworker chat comes
in on the Next request path and shares the engine with **no shared budget and no
priority** — so a wave of autonomous work adds latency to the human waiting. And
the throttle is a blanket "1", not tuned to the actual backend (local vs remote).

Single global choke point confirmed: **every** inference path — fallback chain,
sandbox runner, voice, eval, task-dispatcher — funnels through
`callProvider(providerId, modelId, …)` in `apps/web/lib/inference/ai-inference.ts`,
which already hosts a cross-cutting pre-call budget gate. `providerId === "local"`
identifies the local engine. Both interactive and Inngest-dispatched inference
execute in the **same portal Node process**, so an in-process semaphore is a
correct bound for a single-portal install.

There is no existing `ResourceLane`/semaphore fronting inference — the queueing
substrate (EP-3516E23D) governs Inngest background functions, which cannot cover
the interactive request path. So the primitive is added at `callProvider`.

## Design

New module `apps/web/lib/inference/inference-admission.ts`:

1. **Origin tag** via `AsyncLocalStorage<InferenceOrigin>` (`"interactive" |
   "autonomous"`). `withInferenceOrigin(origin, fn)` binds it for the async
   subtree; `currentInferenceOrigin()` reads it, defaulting to `"interactive"`
   (safe default — the only turn we must demote is background work).
2. **Per-engine priority semaphore.** `engineKeyForProvider` buckets `local` vs
   `remote`. `acquireInferenceSlot(engineKey, origin)` grants immediately below
   the ceiling, else queues; **interactive waiters drain before autonomous** so a
   human never sits behind a scheduled brief. Returns an idempotent release fn.
3. **Config, no UI.** Ceilings read live from env — `DPF_INFERENCE_MAX_CONCURRENCY_LOCAL`
   (default 1), `DPF_INFERENCE_MAX_CONCURRENCY_REMOTE` (default 8); `≤ 0`
   disables gating (escape hatch). `DPF_INFERENCE_ADMISSION_TIMEOUT_MS` (default
   120000) is a safety net against a leaked release. Deliberately env-only: this
   is an infra valve with safe defaults, not an operator-facing control a
   non-technical user must reason about (avoids over-exposing a config surface).

Integration (two seams, minimal):

- `callProvider`: acquire a slot keyed by engine just before `adapter.execute`,
  release in `finally`. Held only across the actual inference call.
- `executeAutonomousAgenticLoop` (`autonomous-work-run.ts`) — the single seam
  both interactive chat (`interactionMode: "chat"`) and autonomous work
  (scheduled self-tasks, build phases, system tasks) flow through — wraps
  `runAgenticLoop` in `withInferenceOrigin`, deriving origin from
  `interactionMode`. Everything else defaults to interactive.

## Verification

- Unit (`inference-admission.test.ts`, 11 cases): origin binding + default;
  engine keying; limit defaults + env override; grant-below-ceiling; queue +
  wake on release; **interactive-before-autonomous priority**; unlimited when
  `≤ 0`; idempotent release; waiter timeout removes from queue.
- Live: with the fleet self-driving, confirm a scheduled brief run and an
  interactive chat contend correctly on the local engine — the chat is served
  first; `[inference-admission] queued for slot` logs on contention.

## Deliberately deferred (follow-ups)

- Distributed lane for multi-replica portals (in-process bound is per-replica).
- Per-provider (not just local/remote-bucket) budgets keyed to each provider's
  rate limit.
- Adaptive sizing from observed engine latency, and a runtime-health surface tile
  for live admission depth.

## 2026-10-12 follow-up — local interactive priority

Live operation proved that local HTTP inference and the sandbox build engine
were not actually governed by one ordering contract: the host-busy probe ran
before both queues, and local HTTP calls crossed both the inference semaphore and
the FIFO ResourceLane. An internal autonomous request therefore looked like an
external busy runner and an interactive turn failed before it could queue.

The canonical follow-up design is
[`2026-10-12-local-inference-interactive-priority-design.md`](../specs/2026-10-12-local-inference-interactive-priority-design.md).
Its atomic delivery extends the existing local ResourceLane with explicit
interactive/autonomous priority plus bounded aging, makes it the one local
execution admission boundary, and moves host probing inside admission. Remote
provider admission remains here unchanged. A PostgreSQL distributed queue stays
deferred until multi-replica portal execution is a supported topology.

### Atomic coverage and traceability

The follow-up is one atomic safety boundary: the admission authority, scheduler,
probe ordering, producer migration and observability cannot ship independently
without leaving contradictory local-GPU paths. It remains owned by
`BI-285EF102` and covers these immutable objectives and acceptance statements:

| Criterion | Objective | Acceptance statement | Verification |
| --- | --- | --- | --- |
| AC-LIP-1 | OBJ-LIP-1 | Portal HTTP inference and the local sandbox build engine use one `compute:local-inference` admission authority; local HTTP dispatch does not hold a second semaphore while waiting for that lane. | Local-provider dispatch tests plus the shared-lane integration test. |
| AC-LIP-2 | OBJ-LIP-2 | With one autonomous holder, one older autonomous waiter and one interactive waiter, execution order is holder → interactive → autonomous; bounded aging still lets an old autonomous waiter progress under repeated interactive arrivals. | Deterministic priority and aging unit tests. |
| AC-LIP-3 | OBJ-LIP-3 | Docker Model Runner and host-GPU probes execute only after local-lane admission, so internal contention queues while a genuinely external or unexpected owner still returns the existing typed busy result. | Probe-order composition test and host-busy regression test. |
| AC-LIP-4 | OBJ-LIP-4 | Aggregate queue-depth, cancellation/failure cleanup, idempotent release, single-GPU exclusion and remote-provider admission tests pass without weakening the host safety fence. | ResourceLane telemetry, bounded-depth, failure and remote-admission regression tests. |
| AC-LIP-5 | OBJ-LIP-4 | On the canonical live install, an interactive coworker selects and executes an attached governed DPF tool within its admission budget while autonomous local inference is active or queued; Operations evidence distinguishes queued internal contention from external host busy. | Protected delivery, exact-live identity and browser/runtime evidence. |

## 2026-10-17 proposed continuation extension

**Planning only; implementation, coverage refresh and acceptance are pending.**
BI-285EF102 / WC-1EBA9720 remains the single delivery home. WWMD
DI-9A4E9EE0053E selects bounded same-turn pre-tool recovery. Section 8 of the
existing local interactive-priority design defines the proposed contract. It
does not amend the background-only BI-F6AD1E18/BI-A50F6B7B or turn original
AC-LIP-5 into a pass. Canonical 305c5e2 is deployed; the last actual long-holder
acceptance attempt remains failed. No new live model probes are part of planning.

### Delivery boundary

This is one atomic correctness boundary: durable acceptance without recovery
loses work; recovery without immutable authority/context/CAS can repeat or widen
work; recovery without durable status/cancellation misleads the person and can
run canceled work. These are internal implementation phases of one deliverable,
not independently shippable features. Reuse BI-285EF102 and existing jobs,
TaskRun, TaskMessage and capacity-wait infrastructure. No new schema or scheduler
is proposed. Reassess classification/sensitivity through the governed scope
claim before source implementation; do not retain medium by assumption.

### Ordered implementation and proof

1. **Ratify the extension and record current coverage.** Independently review
   the closed checkpoint, durable pre-tool fence, identity, cancellation,
   authority revalidation and changed queue/active clock semantics. Preserve
   the original AC-LIP-5 failure and bind the approved extension acceptance to
   the current scope. Record immutable plan coverage; do not reuse an old plan
   head or rewind source to satisfy a stale receipt.
2. **Prove the current failure first.** Add regressions for an acknowledged
   turn whose initial or corrective local dispatch cannot be admitted, event
   emission failure, restart and later-message isolation. Confirm red on the
   named parent; record only results actually run. Resolve related-test advice
   and guard obligations for every final edit path before production edits.
3. **Own accepted turns durably.** Extract server-only preparation/execution/
   persistence from the public action. Audit nested session readers. Extend
   `lib/agent/accept-user-message.ts` and the send route to commit original
   input plus one accepted-turn TaskRun before acknowledgment. Add the closed
   interactive branch to `lib/tak/autonomous-work-run.ts`, preserving the
   external-MCP authority boundary. Test transaction rollback, request-digest
   tampering, thread ownership and exactly one identity.
4. **Persist the exact eligible dispatch.** Add a bounded pre-tool checkpoint
   contract adjacent to `lib/tak/agentic-loop.ts`. Preserve message provenance,
   counters, fixed evidence intent, effective route/tool-schema/skill policy,
   context limits, original warrant and cumulative active work. Enumerate every
   mutable pre-tool variable, preserve raw messages and the exact pending
   dispatch, reject missing/unknown fields and assert excluded tool/intrinsic
   state empty. Typed observed local
   admission expiry alone can park; every tool/intrinsic start commits the
   no-replay fence first. Test the rejected-answer/corrective-dispatch case,
   load_tools and execution-plan exclusions, failed fence persistence, unknown
   or execution-uncertain outcomes, post-tool refusal and missing wait timing.
5. **Resume with the existing executor.** Extend the jobs outbox/reconciler and
   add its interactive queue-function adapter. Reuse deterministic delivery,
   per-turn CAS, capacity backoff/ceiling, oldest-open-turn ordering and fresh
   `currentUserContext`/coworker/Workroom/privacy authorization. Restore the
   pending dispatch instead of invoking a fresh send. Test duplicate workers,
   restart recovery, stale worker settlement, exhausted waits, revoked authority
   and original absolute parent-deadline expiry during backoff. Keep cumulative
   active effort separate from committed parked time; charge unmeasured restart
   gaps conservatively and never reset authority deadlines. Test a crash after
   provider dispatch without a settled rejection as execution-uncertain,
   and unchanged external-MCP token/digest tests.
6. **Finish once and make waiting legible.** Share final-message persistence
   under the stable assistant id. Extend existing status/cancel APIs and their
   panel projection to read/cancel the parent TaskRun durably. Reconnect must
   recover the current state without timer-driven route refresh. Test pending
   state after restart, cancellation before wake/during admission and a race
   with final settlement. Update the existing model-routing lifecycle guide.
7. **Verify and deliver.** Run affected tests and both web typechecks, the
   actual diff's gate context, UX fit, exact-tree canonical CI, independent
   semantic review and all protected PR/merge-group checks. Canonical deployment
   alone proves delivery, not AC-LIR-6. After containing deployment, observe a
   real long autonomous local holder and submit one useful governed turn;
   preserve actual wait/recovery/release/tool/final-answer evidence. No fake
   holder, short idle substitute, timeout/config change, preemption or cloud
   privacy escape can satisfy this proof.

### Traceability and current evidence

Requirement references for the extension are `AC-LIR-1`, `AC-LIR-2`, `AC-LIR-3`,
`AC-LIR-4`, `AC-LIR-5`, `AC-LIR-6` in section 8 of the canonical design.
Contract references: `CONTRACT-accepted-turn-identity`,
`CONTRACT-pretool-checkpoint`, `CONTRACT-current-authority`,
`CONTRACT-original-effort-ledger`. Flow references:
`FLOW-accept-park-resume-settle`, `FLOW-cancel-before-resume`.
Verification references: `VERIFY-corrective-dispatch-recovery`,
`VERIFY-restart-and-duplicate-delivery`, `VERIFY-no-posttool-replay`,
`VERIFY-canonical-natural-long-holder`.

Existing actual failures: RV-WC-1EBA9720-LOCAL-TOOL-20261016T0611Z and
RV-WC-1EBA9720-CLEAN-CONTROL-ADMISSION-20261016. Passing source-pair and idle
governed-read evidence retain their narrower scopes. Source baseline for this
plan extension is 92bd1ea9532a001d10f0c1743a616074be7c93c6, containing current
canonical 305c5e2af8d446c4e263cf96d90fad41c82fc5a2. Tests for this extension
have not run and no native design receipt or refreshed coverage is claimed.

### Risks and rollback

The primary risks are authority drift, a mistaken replay-safe classification,
newer-message contamination, duplicate effect/reply settlement and resetting
spent effort. Every one has a named negative test above. Existing MCP outage
recovery and local admission must retain their original suites. Rollback must
leave compatible recovery available for already accepted turns or settle those
obligations explicitly; disabling submission alone must not strand queued work.
