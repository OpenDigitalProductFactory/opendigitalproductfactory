# Capacity-aware coworker certification — don't fail coworkers on a busy box (BI-44E401B5)

**Status:** implemented (this PR). **BI:** BI-44E401B5.
**Kernel decision (WWMD):** `principle_decide` recommended **origin-aware-patience** —
composite **1.50**, margin **0.70**, confidence **high**; top contributor *Architecture Over
Shortcuts* (+0.40). It rejected the symptom-only patch and the crude global-timeout bump. The
`capacity_utilization` + `cost_efficiency` dimensions are first-class in the registry, so the founder
principle ("capacity-limited work should be queued and served like a business managing utilization —
maximize spend-to-utilization, decrease waste") scores directly.

## Problem

A coworker must pass a nightly golden-journey certification sweep to be promoted. The cert runner is
**binary** (`passed | failed`). `acquireInferenceSlot()` already **queues** waiters over the engine
ceiling (`interactiveQ` then `autonomousQ`), but the admission **timeout was a single 120s budget for
both origins**. On a busy install (`local = 1`) a cert (autonomous) inference call waits in
`autonomousQ`, blows 120s, throws — and the runner scores the journey (hence the coworker) as
**failed**. Good coworkers are wrongly denied promotion because the box was busy, not because they're
bad. That is "turning the customer away" instead of "booking the next slot."

## Design (origin-aware patience + requeue-not-fail)

### Part 1 — origin-aware admission patience (`inference-admission.ts`)
- `resolveAcquireTimeoutMs(origin)` is now per-origin. `interactive` keeps the tight **120s** (a human
  is waiting; fail fast beats hang). `autonomous` (cert / background / deliverable work) is **patient**:
  default **30 min**, so it waits through contention and runs when a slot frees. Both stay bounded as a
  leaked-release safety net. Tunable: `DPF_INFERENCE_ADMISSION_TIMEOUT_MS` (interactive) /
  `DPF_INFERENCE_ADMISSION_TIMEOUT_MS_AUTONOMOUS` (autonomous).
- The admission-timeout rejection is tagged `code = ADMISSION_TIMEOUT_CODE`; `isAdmissionTimeout(err)`
  lets any caller treat capacity backpressure distinctly from a substantive failure. **Reusable** — this
  benefits *all* autonomous work, not just cert.

### Part 2 — requeue, don't fail (`certification-runner.ts` + `queue/functions/coworker-certification.ts`)
- `executeJourney` catches `isAdmissionTimeout` → returns `capacityInconclusive: true` with **no failure
  verdicts** (so no findings are filed).
- `persistCoworkerRun` outcome is now `passed | failed | inconclusive` with a **safety rule: a genuine
  failure trumps capacity backpressure** — a journey that *ran and failed an oracle* still fails the run,
  so a broken coworker can't hide behind a busy box. Only "no genuine failures + some capacity-inconclusive"
  → `inconclusive`.
- The Inngest wrapper **requeues** just the still-inconclusive coworkers: it `step.sleep`s (durably — the
  function suspends, holding no slot) and re-runs them, bounded by `MAX_CAPACITY_REQUEUES` (6) ×
  `CAPACITY_REQUEUE_BACKOFF` (10m). Persistently saturated → those coworkers stay un-promoted, **never
  failed**.

## Verification
- `inference-admission.test.ts`: origin-aware timeouts (interactive vs autonomous env), `isAdmissionTimeout`
  tag, and an **autonomous-patience** test (a tiny interactive budget does not turn autonomous work away).
- `certification-runner.test.ts`: an admission timeout yields an **inconclusive** run (requeue) with no
  findings, not a coworker failure.
- 23/23 green; `apps/web` tsc 0 errors at 8GB.

## Deferred (BI-44E401B5 part 2)
"Cap the tool surface during cert so local model selection doesn't degrade" is a distinct
reasoning-economy concern (the runner already restricts to read-only tools). Tracked as a follow-up so
this PR stays a focused capacity-policy change.
