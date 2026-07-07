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
