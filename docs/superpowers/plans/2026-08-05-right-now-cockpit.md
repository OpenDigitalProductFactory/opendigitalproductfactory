# Plan — AI "Right Now" cockpit: live resource pressure + active work

- **Backlog item:** BI-1A68257F
- **Epic:** EP-FULL-OBS (Full Observability)
- **Decision:** DI-B78B2A014223 (kernel-scored, high confidence — new lean cockpit over stripping/augmenting the Operations Map)
- **Date:** 2026-08-05

## Problem

When Docker starts, host memory reads high (~90%) then drops to ~70% seconds
later. Evidence shows this is expected mechanics, not a leak:

- WSL2 is capped at 24 GB with `autoMemoryReclaim=gradual` (`.wslconfig`, set
  2026-08-04); the reclaim hands idle VM pages back to Windows.
- The Docker Model Runner llama-server loads a model on demand (qwen3-coder is
  16.45 GiB) and self-unloads when idle. The 90%→70% drop is that unload / the
  gradual reclaim, not a fault.
- Container steady-state working set is only ~7.7 GiB across 19 containers.

The real gap: **the portal surfaces none of this.** The operator infers "the
local model kicked in" and "resources are all used" from Windows Task Manager,
not from any portal view. The AI Operations Map (the "subway map") fuses a
station map, topology canvas, replay timeline, deliberation lens, routing
diagnostics, and **future scheduled markers** onto one replay axis — "what's
happening now" is diluted by "what's planned," and there is no resource-pressure
signal anywhere.

## Decision (founder + kernel)

1. Build a **new lean `/platform/ai/right-now` cockpit**. Leave the Operations
   Map intact as the deep analytical/planning altitude. (Kernel: DI-B78B2A014223
   — lowest human_cognitive_load, lowest blast_radius, high reversibility.)
2. Add **real resource telemetry** — currently missing because cAdvisor /
   node-exporter are Linux-only and gated off on this Windows Docker Desktop
   host, so Prometheus scrapes no memory metrics.

## Substrate (verified before building)

- The portal container already bind-mounts `/var/run/docker.sock`
  (`docker-compose.yml`), and `lib/platform-runtime/docker-socket.mjs`
  (`boundedDockerSocketGet`, timeout + max-bytes guarded) is the proven reader —
  used by `local-ci-capacity-broker.ts` (`/info`) and `operational-state.ts`.
- `/proc/meminfo` as seen **inside** the portal is VM-wide on Docker Desktop /
  WSL2 (verified: MemTotal ≈ the 23.47 GiB cap, not a cgroup slice). This is the
  signal that captures the Model Runner even though the model is **not** a
  container (`docker ps` never lists it).
- The Docker Model Runner exposes `/engines/status` (backend running state) and
  `/engines/v1/models` (available models + sizes) at `model-runner.docker.internal`.

## Design

### Data
- `lib/platform-runtime/resource-pressure.ts` — one snapshot loader, every reader
  injectable for tests:
  - **VM memory** from `/proc/meminfo`: `MemTotal - MemAvailable` = the headline
    "we're at N%".
  - **Container attribution** from the Docker socket (`/containers/json` +
    per-container `/stats?stream=false`), using the `docker stats` memory formula
    (`usage - inactive_file`) and CPU formula.
  - **The gap** `vmUsed - Σcontainers` = "model runner + VM overhead" — the
    bucket that balloons ~16 GiB when a local model loads. This is the
    local-model pressure signal, derived with no model-runner API dependency.
  - **Local inference** (best-effort) from the two model-runner endpoints.
  - Degrades gracefully: no `/proc/meminfo` → memory `available:false`; no socket
    → empty container list; no model runner → `reachable:false`.
- `lib/platform-runtime/right-now-activity.ts` — the lean "who's working now"
  read: active/attention `TaskRun`s only, reusing `OPERATIONS_RUN_SELECT`. No
  scheduled/forecast rows (that is the Operations Map's job).

### Surface
- `app/api/platform/resource-pressure/route.ts` — `view_platform`-gated (404
  otherwise), `no-store`. Mirrors the operations-map route.
- `app/(shell)/platform/ai/right-now/page.tsx` — server snapshot + `RightNowLiveShell`.
- `components/platform/RightNowLiveShell.tsx` — polls the endpoint every 12 s
  (paused while hidden). Renders memory hero + "where the memory is" + local
  inference. Working-now list is server-rendered (page-load snapshot).
- `components/platform/platform-nav.ts` — "Right Now" tab beside Operations Map.

## Non-goals
Redesigning/stripping the Operations Map; adding cAdvisor/node-exporter; a new
Prometheus scrape; naming the exact loaded model (no reachable endpoint — the
overhead bucket carries the signal instead); per-phase model detail (already on
Runtime Health, linked, not duplicated).

## Verification
- Unit tests (`resource-pressure.test.ts`): parsing, the docker-stats memory
  formula, the CPU formula, the gap computation, and all three degradation paths.
- Full local CI on the exact merged tree before PR.
