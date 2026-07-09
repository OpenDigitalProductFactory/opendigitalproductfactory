# Usage-based memory expiry + retention pruning — implementation plan

- **BI:** BI-153F7E4A (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 2)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C
- **Status:** Usage tracking + pure policy + expiry runner (this PR)

## Problem

No memory store had a forgetting policy: `UserFact` / `CoworkerMemoryNote` supersede but never expire, and the raw `AgentMessage` log grows unbounded. Unbounded append-only memory degrades quality at write scale (context rot); every mature system has an expiry gate.

## Design

GitHub Copilot Memory's production model — an entry unused past a retention window expires; any recall resets the clock.

1. **Usage tracking** (additive migration `20260709130000_add_memory_usage_expiry`): `lastAccessedAt DateTime?` + `useCount Int @default(0)` on `UserFact` and `CoworkerMemoryNote`. Data-safe (nullable/defaulted), attested in-file.
2. **Recall bump**: a fact injected into context (`loadGovernedUserFacts` → `includedFacts`) fire-and-forget bumps `lastAccessedAt`/`useCount`, so used facts survive. (Note usage begins accruing when the note-injection slice — BI-F9025BA0 slice 2 — injects notes; until then the nightly pass ages notes by creation, which is safe for the low-volume explicit note store.)
3. **Pure policy** `apps/web/lib/tak/memory-expiry.ts`: `selectExpirableEntries` (last-touch older than `DEFAULT_MEMORY_UNUSED_DAYS` = 28, protected entries kept) and `selectPrunableMessages` (only messages **at/behind the checkpoint watermark** AND older than `DEFAULT_MESSAGE_RETENTION_DAYS` = 90 — never unsummarized history; nothing prunable without a watermark). Time injected → 10 deterministic unit tests.
4. **Expiry runner** `memory-expiry-runner.ts`: `expireStaleUserFacts` / `expireStaleCoworkerNotes` expire by **supersession, never a hard delete** (row + provenance survive, just stops injecting); `constraint`-category facts are protected. `pruneSummarizedThreadMessages` hard-deletes only summarized+aged raw messages (content survives in the checkpoint). `bumpUserFactUsage` / `bumpCoworkerNoteUsage` for the recall path. Invoked by the nightly sleep-time pass (BI-907C4327).

## Safety

Per the destructive-actions commandment: memory entries are never hard-deleted (supersede-with-provenance). The only hard delete is raw `AgentMessage` rows that are both folded into the durable summary and older than a generous 90-day window — run in the governed nightly pass, counted and logged.

## Verification

- Unit: `memory-expiry.test.ts` (10 — last-touch fallback, LRU window, protection, custom window, watermark+retention gating, no-watermark no-op). Existing user-facts suite green.
- Runtime (post-merge): a fact unused > 28 days is superseded by the nightly pass and stops injecting; recalling a fact updates `lastAccessedAt`; messages behind the watermark older than 90 days are pruned while the summary retains their content.
