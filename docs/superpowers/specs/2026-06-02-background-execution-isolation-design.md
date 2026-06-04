# Spec: Background Execution Isolation

**Date:** 2026-06-02
**Status:** Approved — open questions resolved by WWMD (2026-06-03)
**Author:** Claude Code (with Mark Bodman)
**IT4IT Alignment:** S5 Operate (D2C) — service monitoring & event handling; runtime/deployment architecture
**Relates to:** `2026-05-09-deployment-contracts.md` (amends), `2026-04-02-infrastructure-auto-discovery-design.md` (supersedes §4.1 execution-location decision), `2026-04-01-platform-operational-health-monitoring-design.md`, `2026-03-16-async-agent-operations-design.md`, self-upgrade quiescence (`BI-40F05BAC`), **BI-9F106818**

---

## 1. Problem Statement

On 2026-06-02, the afternoon after a forced rebuild to `085a933b`, the portal stopped responding to HTTP. Host requests to `/api/health` timed out; requests issued from **inside** the container were also refused; yet `docker ps` reported the container **"Up (healthy)"** and the Node process was alive, still emitting background logs.

Diagnosis (evidence): `netstat` inside the container showed `next-server` LISTENing on `:3000` with **`Recv-Q 60`** — a full accept backlog the process was never draining. The single Node **event loop was blocked**. Logs during the wedge showed an active full discovery sweep (`UniFi discovered…`, `Auto-promoted 3 entities`, `Inferred 95 product→infra edges`) plus model auto-discover/profiling churn ("missed 38/39 discoveries", codex/chatgpt 403 + re-auth round-trips). Restarting the portal cleared it instantly.

**Root cause:** the portal's single Node process is simultaneously the **user-facing HTTP server** and the **executor of heavy background reconciliation**:

1. Inngest functions are **served in-portal** (`apps/web/app/api/inngest/route.ts` → `serve(...)`). The hourly `discovery-full-sweep` cron therefore runs `executeBootstrapDiscovery` (`packages/db/src/discovery-runner.ts`) **inside the portal process**. That pipeline includes synchronous CPU-bound passes — cross-collector relationship inference, taxonomy scoring/normalization, entity promotion, and `O(products × infra)` product→infra edge inference — whose cost scales with dataset size.
2. Startup model revalidation (`apps/web/instrumentation.ts` → `model-revalidation.ts`) and the model "missed discoveries" catch-up add external-API stalls on top.

When there is a lot to reconcile — **maximal right after a rebuild/fresh-seed, or after downtime when catch-up fires** — these passes monopolize the event loop. The HTTP listener stops accepting, the backlog fills, and the host sees timeouts/refusals. The Docker healthcheck does not detect it (it reports "healthy" throughout), so there is **no self-heal**. It recurs on the hourly cron whenever the working set is large enough.

This is the infrastructure-level form of the standing DPF principle *"background eval/probes must be async background jobs, not UI-blocking,"* and it is the mechanism behind the earlier operator observation that *"if the system is off for days these events fire unnecessarily."*

## 2. Goals

1. **Isolate** heavy background execution from the request-serving process so a reconciliation burst can never make the portal unresponsive.
2. **Bound** background work so no single pass monopolizes a CPU core (yielding/batching/concurrency caps), independent of where it runs.
3. **Coalesce** catch-up after downtime/rebuild — one reconciliation, not a replay per missed tick.
4. **Detect & self-heal** an event-loop wedge: the healthcheck must reflect liveness, so a blocked instance is marked unhealthy and restarted.
5. **Preserve single-org/single-host simplicity** — the change must not force small installs into a multi-process topology they don't need (bundled-and-optional, per the "bundled services active by default" rule).

## 3. Non-Goals

- Horizontal scaling / multi-replica portals (the advisory-lock single-flight already assumed by `model-revalidation` is sufficient; this spec does not introduce a distributed scheduler).
- Replacing Inngest as the durable-cron substrate (we keep Inngest; we change **where its functions execute**).
- Rewriting the discovery collectors or the promotion/inference algorithms (extend/bound, don't replace — consistent with the 2026-04-02 spec's own non-goal).
- Moving request-path inference (LLM routing/streaming) off the portal — that is latency-sensitive request work, not background reconciliation.

## 4. Background — why the current design starves

The 2026-04-02 auto-discovery spec **§4.1** chose, explicitly: *"API route + interval timer **in the portal process**"* with a `sweepInProgress` flag. That was a reasonable v1 (one process, no extra container). It later evolved from `setInterval` to **Inngest durable cron** — but the functions are still **served and executed in-portal**, so the execution-location decision was never revisited. The starvation is a direct consequence of that one unrevisited decision: durable scheduling fixed *when* sweeps fire, not *where the work runs*.

Two properties make the blast radius large:
- **Co-location:** request serving and reconciliation share one event loop, so CPU-bound reconciliation directly steals request latency.
- **Invisibility:** the healthcheck is a normal HTTP route on that same loop, but Docker's check tolerance let "healthy" persist while the loop was wedged — the failure mode hid itself.

## 5. Design

### 5.1 Execution topology — **dedicated worker service** (recommended)

Introduce a `worker` service in `docker-compose.yml` that runs the **same image** as the portal (`target: runner`) but with a worker entrypoint. It connects to the same Postgres/Redis/Inngest and **registers the heavy Inngest functions**; the portal stops serving them.

Alternatives considered:

| Option | Isolation | Cost | Verdict |
|--------|-----------|------|---------|
| **A. Dedicated worker container** (same image, worker entrypoint) | Full OS-process isolation; a wedged worker never affects the portal | One more container (same image → no extra build, ~modest RAM) | **Recommended** |
| B. Worker thread / child process inside the portal container | Event-loop isolation only; shares container lifecycle, memory, and `docker restart` blast radius | Lower footprint | Fallback for the most constrained hosts (`DPF_WORKER_INLINE=worker-thread`) |
| C. Status quo + yield/batch only (§5.2) | None (still co-located) | Smallest | Insufficient alone — a large-enough pass still starves; ship as defense-in-depth, not the fix |

Recommendation: **Option A**, with **Option B as an opt-in fallback** and **Option C shipped regardless** as belt-and-suspenders.

### 5.2 Bounding the work (ships independently of topology)

In `discovery-runner.ts`, chunk the CPU-bound passes (cross-collector inference, taxonomy scoring, product→infra matching) and `await` a yield (`setImmediate`/`scheduler.yield`) between batches; cap per-pass concurrency. This makes any single pass cooperatively yield even if it runs in-portal (Option B/C, or during the migration window before the worker exists). This is layer **#2** from BI-9F106818 and is **not gated by this spec** — it lands as a defect PR.

### 5.3 Inngest serving split

The portal keeps serving **lightweight, request-adjacent** functions (e.g. event emit, fast triage) and remains the **event producer** (`inngest.send` stays everywhere). The worker serves the **heavy** functions: `discovery-full-sweep`, `discovery-prometheus-poll`, model revalidation/eval, product promotion/inference. Code-graph refresh and Build Studio dispatch move in a later phase (§7, Phase 3).

**Two registered Inngest apps** (portal-app, worker-app) — WWMD-resolved 2026-06-03 (composite 3.97, margin 1.36, high confidence; strongest: *Never Assume—Verify*, *All Changes Land via PR*). Independent concurrency budgets and clean dashboard separation outweigh the two-registration overhead. One app with tags would share the concurrency budget, undermining the isolation goal.

### 5.4 Shared state, identity, secrets

The worker shares `DATABASE_URL`, `REDIS_URL`, the Inngest endpoint/key, and `CREDENTIAL_ENCRYPTION_KEY` (it decrypts discovery-connection secrets, e.g. UniFi). It runs under the **same client identity** (`agent-…@hive.dpf`) — it is the same install, not a new principal. No new env schema; the worker reads the existing one (Deployment Contract 2 unchanged).

### 5.5 Health & observability

- **Worker health:** its own healthcheck = "Inngest connection live + last-heartbeat within N min," surfaced on the Platform Health tab as a first-class service (per `2026-04-01` monitoring spec; add a `worker` target like the existing sidecars).
- **Portal liveness (layer #5, ships independently):** add an **event-loop-lag** probe to the portal healthcheck (e.g. `perf_hooks.monitorEventLoopDelay`); if lag exceeds a threshold the container reports **unhealthy** so Docker/Compose restarts it. This is the safety net that would have auto-recovered today's incident; it is valuable **even after** the worker lands (defends against any future in-portal regression) and is **not gated by this spec**.

### 5.6 Self-upgrade / quiescence coordination

The worker is a **second long-lived container** the swap must account for. During quiescence:
- The worker must **drain** (finish or checkpoint the in-flight sweep) and **pause** picking up new Inngest work before the portal swaps — reusing the same `portal.quiescence` levels (draining → swapping) the proxy gate already reads.
- The promoter recreates `worker` alongside `portal` in the same swap. A stale worker on the old image must not keep executing against a migrated DB.
- **Own dedicated soft quiescence blocker** — WWMD-resolved 2026-06-03 (composite 5.49, margin 2.23, high confidence; strongest: *All Changes Land via PR*, *Build Gate*). An in-flight sweep defers the swap briefly but does not hard-block, mirroring the existing ToolExecution recency soft signal. Folding it into A-class blockers would conflate reconciliation work with user-session state and make the swap-defer reason opaque.

### 5.7 Backward-compat & small installs

- The `worker` service is **bundled and active by default** (single-org installs get it automatically — no "register" step).
- **No inline fallback** — WWMD-resolved 2026-06-03 (composite 4.26, margin 1.63, high confidence; strongest: *Never Assume—Verify*, *Architecture Over Shortcuts*). The `DPF_WORKER_INLINE` escape hatch is **not shipped**. The inline path reintroduces the shared-event-loop risk we are eliminating — keeping it would mean zero-tech-debt and architecture-over-shortcuts allow a code path that undermines the spec's core guarantee. The worker uses the same image (same build, minimal added RAM) so the footprint increase on constrained hosts is small. Any install that cannot afford it should configure an external LLM endpoint rather than a degraded runtime model.
- Compose wrappers (macos/linux overlays, cloud, edge) inherit the base `worker` definition; no per-platform fork (Deployment Contract discipline).

## 6. Proposed deployment-contracts amendment

Add a contract to `2026-05-09-deployment-contracts.md` (the count is informational and "may grow"):

> **Contract 11 — Background execution isolation.** Durable/scheduled background work (discovery sweeps, model revalidation/eval, promotion/inference, code-graph refresh) executes in a **dedicated worker runtime** separate from the request-serving portal process, so reconciliation load cannot degrade user-facing availability. Deployments may co-locate the worker as a bundled container (default) or, on constrained hosts, as an in-process worker thread (`DPF_WORKER_INLINE`), but request serving and heavy background execution must not share an unbounded event loop. The portal healthcheck reflects event-loop liveness. Single source of truth: `2026-06-02-background-execution-isolation-design.md`.

## 7. Rollout phases

1. **Phase 0 (defect PR, non-gating):** §5.2 yield/batch in `discovery-runner` + §5.5 portal event-loop-lag healthcheck + §5.3 single-flight advisory lock on the full sweep. Immediate recurrence protection + self-heal. *(BI-9F106818 layers #2/#4/#5; does not wait on this spec.)*
2. **Phase 1:** worker entrypoint in the existing image; `worker` compose service (two Inngest apps); move discovery + model reconciliation/eval functions to worker-app; portal stops serving them. Health tab surfaces the worker. *(narrow scope — WWMD §5.3/5.7 resolved)*
3. **Phase 2:** quiescence coordination (§5.6) — worker own soft-blocker; promoter swaps both containers atomically.
4. **Phase 3:** catch-up coalescing (BI-9F106818 layer #3) — cap missed-tick replay. Code-graph refresh and Build Studio dispatch also migrate to worker in this phase once the pattern is proven.

Phases 1–3 are the spec-governed work; Phase 0 ships in parallel.

## 8. Risks & mitigations

- **Two containers diverge in version.** Mitigation: same image + same `DPF_VERSION`; the swap recreates both atomically; worker refuses to run if its source-content-hash ≠ portal's (reuse the existing content-hash guard).
- **Worker silently dies → sweeps stop.** Mitigation: worker healthcheck + heartbeat on the Health tab; missed-heartbeat alert.
- **Resource overhead on small hosts.** Mitigation: same image (no extra build/layers); modest idle RAM; `DPF_WORKER_INLINE` fallback.
- **Hidden request-path dependence on an in-portal function.** Mitigation: §5.3 keeps request-adjacent functions in the portal; migrate only tagged heavy functions; integration test asserts request latency under a forced large sweep.

## 9. Testing & acceptance

- Under a forced large-dataset sweep, `/api/health` p99 stays **< 1s** and the portal accept-backlog stays **~0** (the metric that was 60 during the incident).
- A deliberately blocked event loop flips the portal container to **unhealthy** within the healthcheck window and triggers a restart.
- Killing the worker stops sweeps **without** affecting portal request serving; the Health tab shows the worker down.
- A self-upgrade with an in-flight sweep drains/defers correctly and recreates both containers on the new image (no stale-worker-against-migrated-DB).

## 10. Resolved decisions (WWMD 2026-06-03)

All four open questions resolved via `principle_decide` against the `in_platform_coworker` population with 15 applied principles (10 commandments + 5 retrieved core). No commandment conflicts.

| # | Question | Decision | Composite | Margin | Strongest principles |
|---|---|---|---|---|---|
| a | Inngest app split | **Two apps** (portal-app + worker-app) | 3.97 | 1.36 | Never Assume—Verify, All Changes Land via PR |
| b | Worker quiescence | **Own soft-blocker** | 5.49 | 2.23 | All Changes Land via PR, Build Gate |
| c | Inline fallback | **Mandate worker everywhere** (no `DPF_WORKER_INLINE`) | 4.26 | 1.63 | Never Assume—Verify, Architecture Over Shortcuts |
| d | Migration scope | **Narrow scope** (discovery + model revalidation first) | 5.93 | 1.79 | Never Fabricate, Build Gate |

Note on (c): WWMD **reversed** the initial human lean ("keep fallback"). The kernel scored the inline path's reintroduction of the shared-event-loop risk as a blast-radius and long-term-maintainability deficit — aligned with zero-technical-debt and architecture-over-shortcuts. Small-host reach is addressed by minimal RAM overhead (same image) not a degraded execution model.

## 11. References

- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` — doctrine this amends (Contract 11).
- `docs/superpowers/specs/2026-04-02-infrastructure-auto-discovery-design.md` §4.1 — the original "in the portal process" decision this supersedes.
- `docs/superpowers/specs/2026-04-01-platform-operational-health-monitoring-design.md` — Health tab / target model for the worker + liveness probe.
- `apps/web/app/api/inngest/route.ts`, `apps/web/instrumentation.ts`, `apps/web/lib/inference/model-revalidation.ts`, `packages/db/src/discovery-runner.ts` — the surfaces involved.
- **BI-9F106818** — the tracked bug; Phase 0 layers (#2/#4/#5) ship as a non-gating defect PR.
