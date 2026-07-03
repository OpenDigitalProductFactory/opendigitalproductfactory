# Concurrency & Contention Safety — Implementation Plan

**Date:** 2026-07-02
**Epic:** EP-056D2A5E (Resource contention & concurrency safety)
**Analysis:** [2026-07-02-concurrency-contention-architecture-analysis.md](../specs/2026-07-02-concurrency-contention-architecture-analysis.md)
**Companion:** BI-2726089C (autonomous coworker execution)
**Branch:** `feat/concurrency-safety-ep056d2a5e`

## Kernel decisions (WWMD / `principle_decide`, 2026-07-02)

All scored against the closed `PRINCIPLE_DIMENSIONS` registry, `callingPopulation: in_platform_coworker`, no commandment conflict, strong structured coverage.

| # | Question | Options | Decision | Composite / margin / conf |
|---|---|---|---|---|
| D1 | Local-GPU admission-gate mechanism | atomic-db-lease · inngest-concurrency-key · in-process-only | **atomic-db-lease** | 1.157 / 0.473 / high |
| D2 | Booking overlap exclusion | gist-exclude · unique-discretized · transaction-only | **gist-exclude** | 5.596 / 4.704 / high |
| D3 | BacklogItem claim atomicity | conditional-update · partial-unique-index | partial-unique-index (**tie**) | 1.137 / **0.015** / **low** |
| D4 | Autonomous coworker action authority | propose-only · bounded-autonomous · full-autonomous | **propose-only** | 9.270 / 1.379 / high |

Top contributors across the set: *Architecture Over Shortcuts*, *Never Assume — Verify*. D1/D2 both favored the durable, DB-enforced option over the quick fix. **D3 is a genuine coin-flip (margin 0.015 < tieMargin 0.2)** — the kernel explicitly recommends human review; deferred to the operator. D4 landed firmly on **propose-only**: a self-dispatched coworker may surface an approval card but must not auto-execute a side effect without a human turn.

## Phase 1 — Booking atomicity (BI-CC4659CB) — IMPLEMENTED this PR

Kernel D2 = gist EXCLUDE. Delivered:
- **Migration** `20260702150000_booking_overlap_exclusion`: `CREATE EXTENSION btree_gist`; `StorefrontBooking_no_overlap` EXCLUDE (`providerId =`, `tsrange(scheduledAt, scheduledAt + durationMinutes) &&`) WHERE not-cancelled ∧ provider set ∧ duration>0; `RentalAgreement_no_overlap` EXCLUDE (`rentableUnitId =`, `tsrange(periodStart, periodEnd) &&`) WHERE unit set ∧ status not terminal.
- **`submitBooking`** ([storefront-actions.ts](../../../apps/web/lib/release/storefront-actions.ts)): hold-validate → create → hold-release → recurrence expansion now run in ONE `$transaction`; exclusion violation → "That time slot is no longer available"; hold re-checked inside the txn.
- **`createReservation`** ([rental.ts](../../../apps/web/lib/actions/rental.ts)): conflict pre-check + create + unit-status update in one `$transaction`; exclusion → friendly "already booked".
- **Shared** [isExclusionViolation](../../../apps/web/lib/db/exclusion-violation.ts) helper (detects SQLSTATE 23P01 across Prisma error shapes) + unit tests; extended booking tests (transaction used; 23P01 → 409). 14/14 green.
- **Verify-on-return:** the EXCLUDE constraints need a live Postgres to confirm creation succeeds against existing data (a pre-existing overlap would fail the migration — run against a DB snapshot first) and that Prisma surfaces 23P01 as expected. Unit tests cover the code paths; the DB-enforcement leg is the live-verify step.

## Phase 2 — Local-GPU admission gate (BI-98572A51) — PLAN (not yet coded; inference hot path)

Kernel D1 = atomic-db-lease. Plan:
1. New `LocalInferenceLease`-style gate copying `NonProductionEnvironmentLease.activeKey` (partial unique index → atomic acquire, P2002 → wait/retry, TTL + reaper via the existing `runtime-target-janitor`). Key `local-gpu` (per-device when multi-GPU); limit operator-tunable.
2. Both producers acquire it: the in-process `withLocalInferenceLock` path ([chat-adapter.ts:44](../../../apps/web/lib/routing/chat-adapter.ts)) and the sandbox-CLI dispatch (`MAX_CONCURRENT_TASKS`, [build-orchestrator.ts:1267](../../../apps/web/lib/integrate/build-orchestrator.ts)) — closing R1 (chat + build double-subscription).
3. Admission control (R4): bounded wait / max queue depth with an honest "busy, N ahead / falling back to cloud" signal instead of unbounded silent waiting.
   *Held for a supervised session — changing the inference dispatch path unattended is too risky to verify remotely.*

## Phase 3 — Atomic BacklogItem claim (BI-B62B9F1E) — BLOCKED on D3 operator call

Prerequisite for autonomous concurrent coworkers. D3 is a tie: **conditional-update** (single-statement CAS, no migration) vs **partial-unique-index** (matches the nonprod gold standard, needs a sentinel column + migration). Recommend the operator pick; both are race-safe. Then upgrade the advisory check at [mcp-tools.ts:6140](../../../apps/web/lib/mcp-tools.ts) and add a stale-claim reaper.

## Phase 4 — Autonomy execution model (BI-2726089C) — DESIGN, governed by D4

Self-dispatched coworker runs go through **Inngest** (inherit concurrency keys + the Phase-2 GPU gate + retries + quiescence), NOT the inline fire-and-forget path. Action authority = **propose-only** (D4): emit approval cards, never auto-execute. Depends on Phase 3 (atomic claim) so two autonomous runs cannot grab the same item.

## Phase 5 — Scheduled-task idempotency (BI-D1CD3A11) — PLAN (runtime-sensitive)

Claim-before-execute: atomically advance `nextRunAt` (CAS `updateMany` WHERE `nextRunAt <= now`) at selection so a re-poll cannot re-fire; reconcile with the end-of-run update in [agent-task-scheduler.ts:336](../../../apps/web/lib/actions/agent-task-scheduler.ts) to avoid double-advance; idempotency key on the dispatch event. *Held — needs the live dispatcher to verify the failure/re-fire interaction.*

## Phase 6 — Decision-rule contract (BI-94A765BD) — PLAN

Codify §4 of the analysis (compute→admission gate; record→atomic constraint; advisory only for cooperative human coordination) as an AGENTS.md contract / kernel principle broadening `runtime-gates-via-shared-lease`.

## Sequencing

Phase 1 ships now (self-contained, tested). Phase 3's D3 call unblocks Phase 3→4. Phases 2 and 5 are the hot-path/runtime-sensitive items for a supervised session. Phase 6 any time.
