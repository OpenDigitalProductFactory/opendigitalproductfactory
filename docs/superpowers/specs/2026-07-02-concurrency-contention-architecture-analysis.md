# Concurrency & Resource-Contention Architecture Analysis

**Date:** 2026-07-02
**Status:** Analysis / design input (advisory — not yet a plan)
**Author:** Investigation across four subsystems (local-LLM inference, booking/scheduling, shared-resource leases, job-queue concurrency)
**Related:** BI-2726089C (autonomous coworker execution), EP-F7E35344 (AI Coworker Capability Inputs), [runtime-gates-via-shared-lease principle](../../founder-kernel/wiki/principles/runtime-gates-via-shared-lease.md)

---

## 1. Executive summary

The operator's concern: as AI coworkers become more autonomous and concurrent, they will contend over scarce resources — the **single local GPU** (serial by nature), **booking/scheduling slots** (one slot, one booking), and **shared work records** (one session per backlog item). We need to be well-architected to avoid overload, timeouts, and race conditions.

**Finding: DPF does not need a new concurrency subsystem. It already contains the two canonical primitives — it just applies them unevenly.** Contention splits into two classes, each with a proven in-repo fix:

| Contention class | Canonical primitive already in repo | Where it works today | Where it's missing |
|---|---|---|---|
| **Serialize execution against a scarce compute resource** (local GPU) | Inngest **key-scoped concurrency** (`{key, limit}`) + in-process `withLocalInferenceLock` promise chain | evals, research, build pipeline; in-process HTTP inference | coworker inference isn't queued; **two independent GPU serializers don't coordinate**; no admission control / max-in-flight |
| **Mutually exclude writes to a shared record/slot** (bookings, claims) | Postgres **partial-unique-index atomic gate** (`NonProductionEnvironmentLease.activeKey`) | nonprod environment leasing (fully atomic, TTL + reaper) | booking/rental have **no constraint at all** (TOCTOU double-booking); WorkCapsule + BacklogItem claims are **advisory** (race under clock skew) |

The recommendation (Section 5) is to **generalize these two patterns** to the domains that lack them, not to build something new.

---

## 2. As-is scorecard

### 2.1 Local LLM inference (scarce compute — must serialize)

- **In-process serializer exists and is correct.** `withLocalInferenceLock()` — a single module-level promise chain — funnels every `providerId === "local"` call so the single GPU serves one request at a time. Crucially the abort/timeout clock starts *inside* the lock, so a call's timeout measures real inference, not queue-wait. ([chat-adapter.ts:44-62, 354-363](../../../apps/web/lib/routing/chat-adapter.ts))
  - This means even the fire-and-forget inline coworker path is serialized for local inference **within one Node process** — good.
- **Second, independent serializer for the sandbox path.** Local build engine (opencode) spawns its own model process inside the sandbox container, which the in-process promise chain cannot see, so the orchestrator separately caps `MAX_CONCURRENT_TASKS = 1` for local engines (`2` for cloud). ([build-orchestrator.ts:1267-1314](../../../apps/web/lib/integrate/build-orchestrator.ts))
- **⚠️ The two serializers don't know about each other.** The promise chain guards HTTP inference (chat/coworker/reviewers-in-process); `MAX_CONCURRENT_TASKS` guards sandbox-CLI dispatch. A coworker chat and a local build specialist can therefore **still hit the one GPU simultaneously** — the exact "both reviewers timed out" failure class (BI-0F291741, FB-71FB3A53), just across the two mechanisms instead of within one.
- **⚠️ No admission control / max-in-flight.** Under many concurrent coworkers the promise chain just grows unbounded — no shed-load, no fairness, no priority, no max queue depth. A 10-deep queue means the 10th caller waits ~10× inference time with no feedback.
- **Local capacity is never sensed.** DMR/Ollama don't emit rate-limit headers, so `rate-tracker.ts` learns nothing for local; the only saturation signal is a 529/timeout after the fact. Mitigations exist (`LOCAL_FALLBACK_MAX_TOOLS = 15` to avoid tool-selection collapse; served-context self-heal). ([fallback.ts:210-232](../../../apps/web/lib/routing/fallback.ts))
- **Coworker execution bypasses the queue entirely.** `/api/agent/send` runs `sendMessage()` inline as fire-and-forget; it never enters Inngest, so it inherits none of Inngest's per-resource concurrency governance. ([send/route.ts:88-145](../../../apps/web/app/api/agent/send/route.ts))

### 2.2 Booking / scheduling (shared slot — must mutually exclude)

**All slot-reservation paths are check-then-act with no atomic backstop → double-booking races.**

- `BookingHold` create: conflict-check then insert, **no `@@unique`** on `(providerId, slotStart, slotEnd)`. ([hold/route.ts:70-89](../../../apps/web/app/api/storefront/[slug]/hold/route.ts))
- `StorefrontBooking` create: validates hold then creates **outside a transaction**; hold-validate → create → hold-delete is not atomic. ([storefront-actions.ts:120-186](../../../apps/web/lib/release/storefront-actions.ts))
- `RentalAgreement` create: `hasUnitConflict()` pure-function check then create, **no `@@unique`** on `(rentableUnitId, periodStart, periodEnd)`. ([rental.ts:112-145](../../../apps/web/lib/actions/rental.ts))
- Present but insufficient: `bookingRef`/`agreementRef`/`idempotencyKey` uniques (dedup submissions, not slots); `BookingHold` optimistic layer (advisory). Rental **checkout/return** correctly use `$transaction` — reservation does not.

### 2.3 Shared work records (one session per resource)

- **Gold standard — atomic:** `NonProductionEnvironmentLease` uses a **partial unique index on `activeKey`** so at most one active lease exists per environment key; claim is a `CREATE` that either wins or hits P2002 (caught → reported as conflict). Hard 20-min TTL, heartbeat renewal, hourly reaper. This is the pattern to copy. ([environment-lease.ts:66-220](../../../apps/web/lib/nonprod/environment-lease.ts))
- **Atomic-enough:** `RuntimeTarget` upsert-by-`targetId` (idempotent, no collision). ([runtime-targets.ts:172-224](../../../apps/web/lib/runtime-coordination/runtime-targets.ts))
- **⚠️ Advisory (TOCTOU / clock-skew race):**
  - `BacklogItem` claim-on-start: reads claim freshness then updates in a transaction, but the *check reads pre-transaction state* — two sessions can both pass the stale-check and both claim; 12h stale window. `force=true` override. ([mcp-tools.ts:6140-6214](../../../apps/web/lib/mcp-tools.ts))
  - `WorkCapsule` lease + `scopeClaims`: JS-level overlap detection over a `findMany`, then update — classic TOCTOU; no reaper for stale leases. `force=true` override. ([work-capsule-store.ts:507-632](../../../apps/web/lib/work-capsules/work-capsule-store.ts))

### 2.4 Job queue (the serialization plane)

- **Inngest is the coherent place to serialize**, and it already does per-resource: `{ key: "event.data.organizationId", limit: 1 }` (research, brand-extract), `{ key: buildId, limit: 1 }` (pre-build repair), `{ limit: 2 }` (evals). ([inngest functions](../../../apps/web/lib/queue/functions/))
- Optional account-scoped admission lane exists but is **off by default** and build-only (`DPF_BUILD_PIPELINE_CONCURRENCY`). ([admission.ts](../../../apps/web/lib/queue/admission.ts))
- **No global "max concurrent AI tasks" / "total in-flight inference" budget tied to the physical host.**
- **Cross-cutting absences:** no Postgres advisory locks, no `SELECT … FOR UPDATE`, no optimistic version columns, no Redis/redlock anywhere. All coordination = Postgres unique constraints + advisory checks. Transactions default to READ COMMITTED (no explicit Serializable).

---

## 3. Race-condition risk register (ranked)

| # | Risk | Severity | Root pattern | File |
|---|---|---|---|---|
| R1 | **GPU double-subscription** — chat inference (promise chain) + local build specialist (sandbox) hit one GPU concurrently; timeouts/502s | **High** | two uncoordinated serializers | chat-adapter.ts ↔ build-orchestrator.ts |
| R2 | **Double-booked service slot** — two `BookingHold`/`StorefrontBooking` for same provider+time | **High** | check-then-act, no `@@unique`, no txn | hold/route.ts:70; storefront-actions.ts:120 |
| R3 | **Double-booked rental unit** — overlapping `RentalAgreement` for same unit+period | **High** | check-then-act, no `@@unique` | rental.ts:112 |
| R4 | **Unbounded local-inference queue** — N concurrent coworkers → queue grows, no shed-load/priority; late callers silently starve | **Medium-High** | no admission control | chat-adapter.ts:55 |
| R5 | **Duplicate BacklogItem claim** — two autonomous sessions both start the same BI | **Medium** (rises with autonomy) | advisory check, not atomic | mcp-tools.ts:6140 |
| R6 | **Duplicate scheduled-task fire** — re-fire if execution fails after run, before `nextRunAt` update; non-idempotent agentic tasks accumulate | **Medium** | post-exec cursor update, no idempotency key on event | agent-task-dispatch.ts; agent-task-scheduler.ts:336 |
| R7 | **WorkCapsule scope TOCTOU** — overlapping edit scope claimed between detect and update | **Low-Medium** | advisory, no reaper | work-capsule-store.ts:507 |
| R8 | **Partial recurring-booking tree** — parent created, child fails, no rollback | **Low-Medium** | loop without txn | storefront-actions.ts:163 |

---

## 4. The unifying principle

> **Decide by resource type, then apply the matching primitive.**
>
> - **Physical/compute scarcity** (one GPU, one CLI worker slot, rate-limited provider) → **serialize execution through a single admission gate** — an Inngest key-scoped concurrency lane *or* an atomic lease, keyed to the physical resource, that **every** producer of that work acquires.
> - **Logical record/slot exclusivity** (one booking per slot, one session per BI) → **let Postgres be the arbiter** — an atomic write (partial unique index / constraint) so the DB rejects the loser. Advisory checks are acceptable only for cooperative coordination where a rare double is tolerable and `force` is meaningful.

The failure mode across R1/R2/R3/R5 is the same anti-pattern in two costumes: **checking in application code, then acting, with no atomic backstop.** DPF has already solved it correctly once (nonprod `activeKey`); the work is to reuse that.

---

## 5. Recommended architecture

### 5.1 One shared local-GPU admission gate (addresses R1, R4)

Introduce a **single GPU gate** that both inference paths must pass — modeled on the `activeKey` atomic lease (or an Inngest global concurrency key if inference is routed through the queue — see 5.4):

- Key: `local-gpu` (or per-device when multi-GPU), `limit: 1` (operator-tunable per host).
- **Both** the HTTP `withLocalInferenceLock` path **and** the sandbox `MAX_CONCURRENT_TASKS` path acquire the same gate, so chat + build can never double-subscribe.
- Add **admission control**: bounded queue depth + a fast, honest "local model busy, N ahead of you / falling back to cloud" signal instead of silent unbounded waiting. Tie the limit to sensed host capacity (VRAM/cores) rather than a hardcoded 1.
- Keep cloud providers ungated (their concurrency is governed by provider rate limits + `rate-tracker`).

### 5.2 Make booking atomic (addresses R2, R3, R8)

- Add DB constraints so double-booking is a **database error, not a logic bug**:
  - `@@unique` (or a Postgres exclusion constraint on a `tstzrange` for true overlap, which unique can't express) on `StorefrontBooking(providerId, scheduledAt, …)` and `RentalAgreement(rentableUnitId, period)`.
  - Exclusion constraints (`EXCLUDE USING gist … WITH &&`) are the correct primitive for *overlap*; a plain `@@unique` only catches identical windows. Recommend the exclusion constraint for rentals/time-ranges.
- Wrap hold-validate → booking-create → hold-delete (and recurring parent+children) in a single `$transaction`.
- Treat P2002/exclusion violation as a clean "slot taken" 409, mirroring the nonprod-lease P2002 handling.

### 5.3 Upgrade claims from advisory to atomic where correctness matters (addresses R5, R7)

- For **autonomous** coworker execution (the BI-2726089C world), the BacklogItem claim must be atomic — otherwise two autonomous agents will eventually both grab the same BI. Cheapest route: a partial unique index on `(itemId) WHERE claimStatus='active'`-style sentinel, same shape as `activeKey`, so the claim is a race-safe CREATE/UPDATE. Keep `force` for deliberate override; add a reaper for the 12h/TTL staleness rather than checking age inline.
- WorkCapsule scope: acceptable as advisory for *human-coordinated* sessions; if it becomes a gate for autonomous agents, it needs the same atomic upgrade + a stale-lease reaper.

### 5.4 Route autonomous/background coworker work through Inngest (addresses R4, R5, R6; ties to BI-2726089C)

The autonomy feature from BI-2726089C should **not** reuse the inline fire-and-forget path. Autonomous coworker runs should be **Inngest functions** so they inherit:
- key-scoped concurrency (e.g. `{ key: local-gpu }`, `{ key: organizationId }`),
- the global GPU gate (5.1),
- retries, idempotency keys on dispatch events (fixes R6's re-fire), and
- the quiescence protocol (drain during self-upgrade).

Interactive/user-typed messages can stay inline (already serialized in-process by the lock), but any **self-initiated** work belongs on the queue with a claim.

### 5.5 A single documented decision rule

Capture Section 4 as a kernel principle / AGENTS.md contract ("contention: compute → admission gate; record → atomic constraint; advisory only for cooperative human coordination") so new features don't reintroduce check-then-act. The existing [runtime-gates-via-shared-lease](../../founder-kernel/wiki/principles/runtime-gates-via-shared-lease.md) principle is the seed; broaden it.

---

## 6. Filed backlog — epic EP-056D2A5E (companion to BI-2726089C)

- **BI-98572A51** (bug): Unify the two local-GPU serializers behind one admission gate (R1). Sandbox + HTTP inference share it.
- **BI-CC4659CB** (bug): Atomic booking/rental constraints + transactional hold-to-booking (R2, R3, R8). Prefer gist exclusion constraint for time-range overlap.
- **BI-6112DDE0** (feature): Local-inference admission control — bounded queue, capacity-sensed limit, honest busy/fallback signal (R4).
- **BI-B62B9F1E** (feature): Atomic BacklogItem claim + reaper, as prerequisite for autonomous concurrent coworkers (R5) — dependency of BI-2726089C.
- **BI-D1CD3A11** (bug): Scheduled-task idempotency keys + advance `nextRunAt` before execution / idempotent agentic wrapper (R6).
- **BI-94A765BD** (doc): the contention decision rule (5.5).

Several carry real trade-offs (GPU limit values, exclusion-constraint migration risk, autonomy authority) that should route through the kernel (WWMD) rather than be decided ad hoc.

Several of these carry real trade-offs (limit values, exclusion-constraint migration risk, autonomy authority) that should route through the kernel (WWMD) rather than be decided ad hoc.
