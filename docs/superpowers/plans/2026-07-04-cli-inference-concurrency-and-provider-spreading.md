# Plan — Bound CLI inference concurrency + spread load across providers

- **Date:** 2026-07-04
- **Backlog items:** BI-CE7DE053 (concurrency cap), BI-15068745 (proactive multi-provider spreading)
- **Related PR:** #2578 (reactive CLI rate-limit backoff — the safety net once a provider 429s)
- **Kernel decision:** `principle_decide` (in_platform_coworker, high confidence, composite 8.17 / margin 2.51, no commandment conflict) — reuse the existing capacity-weighted scorer rather than build a new load-balancer subsystem.

## Problem

The portal on :3000 intermittently stops responding. Root cause (confirmed on the live install 2026-07-04): a **Codex CLI retry-storm**. Both CLI execution adapters (`codex-cli-adapter.ts`, `cli-adapter.ts`) spawn a `docker exec <sandbox> <runner>` child held open up to `CLI_TIMEOUT_MS` (10 min) through the **single shared sandbox** container, with **no concurrency bound**. A fan-out — Build Studio (`reviewDesignDoc` = 3 parallel reviewers) **or many concurrent AI coworkers** — piles dozens of held-open `docker exec` children onto the one sandbox and the Docker daemon, starving the portal event loop.

The scarce resource is the shared sandbox, shared by every CLI caller — so the protection must live at the shared adapter seam and be **global**, not scoped to Build Studio.

## Phase 1 — Global CLI concurrency gate (this PR) — BI-CE7DE053

New module `apps/web/lib/routing/cli-concurrency.ts`: a process-global bounded semaphore (`withCliSlot`). Both CLI adapters wrap ONLY their heavy spawn-and-wait block with `withCliSlot(...)`; cheap prep (auth, temp-file writes) stays outside so slots turn over on real inference.

- Cap defaults to **4**, env-overridable via `DPF_CLI_MAX_CONCURRENCY`. Excess calls FIFO-queue; none are dropped.
- Slot released on settle (resolve OR reject, including the 10-min timeout path), so a hung CLI never permanently leaks a slot.
- Contention is logged (`[cli-concurrency] queued for a CLI slot ...`) for operator observability.
- This is the CLI analog of `chat-adapter.ts`'s `withLocalInferenceLock` (which serializes the single-GPU local endpoint).

Covers **both** Build Studio and coworker inference automatically, since all CLI inference routes through these two adapters.

Tests: `cli-concurrency.test.ts` — cap enforcement, FIFO ordering, slot release on rejection, env default/override.

## Phase 2 — Proactive multi-provider spreading (follow-up) — BI-15068745

The router already discounts an endpoint's fitness above 80% utilization (`pipeline.ts:379`, fed by `rate-tracker.ts`), so it spreads concurrent requests toward less-loaded providers — but this is inert for CLI/subscription providers:

1. **Invisible caps.** `checkModelCapacity` returns 0% utilization when an endpoint has no known rpm/tpm/rpd limits. CLI subscriptions publish no rate headers, so they read 0% forever and the penalty never fires. *Recommended safe fix:* feed the Phase-1 concurrency-slot saturation (`cliConcurrencyStats`) into `checkModelCapacity` for CLI-backed providers as the utilization signal — no rate-number guessing required.
2. **Hard pins bypass the scorer** (`pipeline-v2.ts` pinnedOverride, `routed-inference.ts` preferredProviderId). *Fix:* tier-route high-fan-out phases to a pool instead of a single pin. **Needs operator steer** on which phases must stay pinned to a specific model (output-quality trade-off), so it is deliberately deferred to a separate PR.

## Layering

The three protections compose: **proactive spreading** (Phase 2) → **reactive fallback** (PR #2578) → **hard concurrency bound** (Phase 1).
