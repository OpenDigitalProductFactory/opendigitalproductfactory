---
status: active
---

# Plan — Hive Scout market aperture: daily inbound product intelligence (BI-B8E4317D)

**Date:** 2026-08-16
**Spec:** docs/superpowers/specs/2026-08-16-hive-scout-market-aperture-design.md
**Epic:** EP-5EA15B45 · **Blocker context:** BI-FC28F1E3 (verified, evidence recorded)

## Backlog coverage

**Umbrella item:** BI-B8E4317D. Coverage decision: **atomic** — the source list, market pass, prompt reshaping, and summary surfacing are one behavioural unit (a source list without the pass does nothing, the pass without the prompt produces unread material, and the prompt without the pass hallucinates); no phase is independently shippable. Dependencies: none.

**Governed coverage receipt: not yet recorded for this plan.** Verified 2026-11-11 against the live install. An earlier note here said "Zero `initiative_scope_baseline` rows still exist install-wide" — that is no longer true and should not be relied on: **683** baselines and **50** schema-v2 `plan_backlog_coverage` receipts now exist, the most recent recorded today. The lane works; what is missing is specific to this plan. Its umbrella `BI-B8E4317D` has **no** `initiative_scope_baseline`, and a v2 receipt binds to one. A baseline is written only by a passing `spec-approval` over a canonical design under `docs/superpowers/specs/` whose objectives are marked `**OBJ-*:**` and whose acceptance statements are `| AC-* | OBJ-… | statement |` rows. This plan has no such design, so the gate has nothing to baseline — that is the whole remaining gap, and it is authoring work, not a platform defect. Two earlier causes named here are closed: `BI-B9403248` (artifact provenance) and `BI-72F368BC`'s reviewer-attribution defect (PR #4605). `BI-72F368BC` remains open but rescoped — it now reads "reachable only from an in-portal coworker — no external surface can produce one", so an external CLI session still cannot mint the baseline itself even once a design exists. `BI-ECFE0AC2` (reviewers completing with zero tool executions) is closed. Restore this section — marker plus live receipt id — when the design lands and the baseline is written. Re-read the live backlog before trusting any of the above; this note has been wrong twice.

## Phases

### Phase 1 — market-sources module (new)

`apps/web/lib/actions/hive-scout/market-sources.ts`:

- `MarketSource` / `MarketSourceMaterial` types; `DEFAULT_MARKET_SOURCES` (verified-fetchable defaults, capped list).
- `loadMarketSourceSettings(platformConfig)` — `hive-scout.market.enabled` + `hive-scout.market.sources` PlatformConfig override with shape validation and default fallback (mirrors `hive-scout.review.*`).
- `runMarketSourcePass({ db, fetcher, now })` — per-source fetch → markup strip → bounded text → content hash → changed-vs-`RawSource.locator` detection → `upsertRawSource` (sourceKey `hive-scout:market:<url-hash>`) → bounded material; per-source error capture.
- Unit tests: config parsing/fallback/cap, markup stripping, change detection across runs, per-source failure tolerance, material bounds.

### Phase 2 — ingest integration

- `ingest-500-agents.ts`: invoke the market pass after the catalog pass (small delta; logic lives in the new module); `IngestResult.marketSources` block.
- `discovery-inventory-pack.ts` handler message: append market-pass counts.
- Extend the ingest run test for the `marketSources` result block.

### Phase 3 — prompt + charter

- `packages/db/src/hive-scout-config.ts`: extend `buildHiveScoutScheduledPrompt` with the product/market aperture, the design-challenge question ("what does this make effortless that our model would not catch?"), the ≤2-suggestions-per-run + cite-source + never-import-code + no-finding-is-valid rules. Live row picks it up via `ensureHiveScoutScheduledTask` on reseed.
- `packages/db/src/seed.ts` prompt context + `packages/db/data/agent_registry.json` `capability_domain`: widen wording from agent catalogs to the product/market space (no grant changes).

### Phase 4 — daily-surface honesty

- `agent-task-scheduler-summary.ts` `extractHiveScoutSummary`: include market metrics (attempted/fetched/changed/failed) in the payload; extend its test.

### Phase 5 — verification & routing

- Build gate: vitest for touched packages; `pnpm --filter web build`; no migration (not applicable); UX surface unchanged (agent behaviour verified via the run-shaped test below).
- Run-shaped verification: ingest run test drives `runHiveScoutIngest` end-to-end with injected fetcher + in-memory prisma seam, asserting market material and RawSource citation writes.
- Inaugural intelligence pass executed in-session against the seeded sources: cited findings filed as governed triage suggestions, including ≥1 concrete spec-challenge finding (PR #4355 shape).
- Durable findings routed to the commons/hive; execution evidence recorded on BI-B8E4317D.
