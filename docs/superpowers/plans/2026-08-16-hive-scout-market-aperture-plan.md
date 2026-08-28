---
status: active
---

# Plan — Hive Scout market aperture: daily inbound product intelligence (BI-B8E4317D)

**Date:** 2026-08-16
**Spec:** docs/superpowers/specs/2026-08-16-hive-scout-market-aperture-design.md
**Epic:** EP-5EA15B45 · **Blocker context:** BI-FC28F1E3 (verified, evidence recorded)

## Backlog coverage

**Umbrella item:** BI-B8E4317D. Coverage decision: **atomic** — the source list, market pass, prompt reshaping, and summary surfacing are one behavioural unit (a source list without the pass does nothing, the pass without the prompt produces unread material, and the prompt without the pass hallucinates); no phase is independently shippable. Dependencies: none.

**Governed coverage receipt: still blocked; the blocker has moved.** BI-B9403248 is fixed and merged (`1637cfa3b`): the repository-artifact check no longer asks which surface produced the commit, so the artifact resolves for an externally-authored plan, and a conformance test pins that (`plan-coverage-external-conformance.test.ts`, `cd3a6e307`). Schema-v2 coverage additionally requires an `initiative_scope_baseline`, written only by a passing `spec-approval`. **Correction to an earlier note here:** that gate was described as unreachable because the install has a single human principal. That was wrong on both counts — the install has several human and agent principals, and the actual cause was an identity resolution that read the reviewer principal from the human alias alone. PR #4605 fixed it (BI-72F368BC), so the lane is reachable in principle. The live frontier is now BI-3EC58C5A (the Change Reviewer is promoted and reads the artifact, but the turn records no tool execution) and BI-ECFE0AC2 (external initiative reviewers complete with zero tool executions). Zero `initiative_scope_baseline` rows still exist install-wide. Restore this section's governed coverage block (marker + live receipt) once one can actually be written; check those two items rather than assuming this note is current.

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
