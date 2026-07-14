# Plan — Unify the two local-GPU serializers behind one admission gate (BI-98572A51)

**Kernel decision (2026-07-14, external_coding_agent, high confidence 10.91):** `unified-inprocess-lane` — route the local build engine through the *same* in-process `ResourceLane` chat uses, over a cross-process DB lease or a bounded fast-fail-to-cloud variant.

## Problem
The single local GPU (DMR/Ollama) serves one request at a time, but two independent gates guard it:
- **Chat:** `withLocalInferenceLock` (the `compute:local-inference` `ResourceLane`, concurrency-1) in the portal — applied at `chat-adapter.ts` for `providerId === "local"`.
- **Build (opencode local engine):** serialized *only* by the orchestrator's per-build `MAX_CONCURRENT_TASKS = 1` loop (`build-orchestrator.ts`, BI-0F291741).

They don't share a gate, so chat + a build specialist (or two concurrent builds) each admit a local-GPU request → collision/OOM/timeout. The code already documents the gap (`build-orchestrator.ts:1267`).

## Why in-process suffices (process-boundary analysis)
Although opencode inference *executes* in the `dpf-sandbox-1` container, **admission is controlled by the portal in both paths**: chat makes the HTTP call; the orchestrator spawns *and awaits* the `docker exec` for the CLI's whole run. DPF deploys a single portal container, so one in-process serial-1 lane held around both the chat call and the awaited docker-exec serializes all local-GPU admission (chat + build + concurrent builds). A cross-process DB lease is only required for a multi-portal deployment — deferred (noted below).

## Changes
1. `queue/resource-lane.ts` — make it the **canonical home** of `withLocalInferenceLock` (beside `LOCAL_INFERENCE_LANE_KEY`), so the lane singleton's telemetry deps are independent of which caller loads first.
2. `routing/chat-adapter.ts` — import + re-export `withLocalInferenceLock` from resource-lane (removes the duplicate local definition; existing importers/tests unaffected).
3. `integrate/opencode-dispatch.ts` — wrap the awaited `runSandboxAgentCli(...)` (the held-open local CLI run) in `withLocalInferenceLock`, so every local build inference acquires the same lane as chat.
4. Tests — `resource-lane.test.ts` asserts `withLocalInferenceLock` serializes concurrent callers strictly one-at-a-time and returns the one keyed singleton (chat + build share it); existing `chat-adapter.test.ts` lane test continues to pass via the re-export.

## Deferred (noted, not this BI)
A cross-process admission lease (pg_advisory_lock on the endpoint, or `nonProductionEnvironmentLease` keyed `local-gpu:<endpoint>`) for a future multi-portal/replica deployment; and, if chat blocking behind a 30-min local build proves painful, the bounded-queue fast-fail-to-cloud variant (set `DPF_LOCAL_INFERENCE_MAX_QUEUE_DEPTH` — the lane already supports `LaneBusyError`, which the fallback chain can route to cloud).

## Verification
Worktree typecheck green; `resource-lane` + `chat-adapter` lane suites green (14/14 + 2/2). Local-CI pregate for the merged gate.
