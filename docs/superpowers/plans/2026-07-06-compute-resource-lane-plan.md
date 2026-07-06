# EP-3516E23D Phase 2 — Compute ResourceLane + local-inference admission (BI-6112DDE0)

**Spec:** [docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md](../specs/2026-07-06-reusable-queueing-substrate-design.md) §4.3
**BI:** BI-6112DDE0 (EP-056D2A5E / EP-3516E23D). Depends on Phase 1 (telemetry spine, #2652).
**Goal:** Give scarce in-process compute the reusable admission primitive the spec calls
for, and put the local-GPU inference path on it — with a bounded queue + honest busy
signal (the root cause of the "both reviewers timed out" incident) and flow telemetry —
without changing default behavior.

## What changed

- **`lib/queue/resource-lane.ts`** — `ResourceLane`: a single-slot FIFO admission gate
  with (1) an optional bounded queue depth (over-cap ⇒ `LaneBusyError`, the honest busy
  signal) and (2) enqueued/started/finished flow telemetry. `getResourceLane(key)` shares
  one lane per resource key. **Unbounded + no telemetry by default ⇒ byte-for-byte the
  promise-chain serializer it replaces.** 12 unit tests (FIFO order, failure-doesn't-wedge,
  bounded reject, telemetry, singleton, config parsing).
- **`lib/routing/chat-adapter.ts`** — `withLocalInferenceLock` now delegates to the shared
  `compute:local-inference` lane. Bounded admission + telemetry are gated on
  `DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH`: **unset ⇒ unbounded serialize, no per-inference DB
  writes** (identical to before); set ⇒ over-capacity calls get `LaneBusyError` (and fall
  back to a cloud provider via the existing error path) instead of piling up and timing out,
  and lane wait/process time becomes measurable. The existing serialization test is unchanged
  and still green.

## Verification

- 33 tests green (12 new resource-lane + the existing 21 chat-adapter incl. the serialization
  contract); `tsc --noEmit` clean; module-size OK.
- Live (post-merge+deploy, opt-in): set `DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH` and saturate the
  local lane with N+2 concurrent inferences → excess get an honest busy signal + fall back,
  none silently time out waiting; `get_queue_status` shows the `compute:local-inference` lane.

## Not in this phase — BI-98572A51 (deferred with rationale)

Unifying the two local-GPU serializers (chat HTTP inference vs the build orchestrator's local
Opencode engine) is NOT shipped here. Routing a long-running build task (up to 30 min holding
the GPU) and interactive chat inference through one lane is a **policy decision** — should chat
wait behind a build, or get a busy signal and fall back to cloud? — that needs an operator/kernel
call and a real load test, not an autonomous guess. The `ResourceLane` primitive this PR ships is
exactly what that coordination will use once the policy is decided. Filed under EP-056D2A5E.
