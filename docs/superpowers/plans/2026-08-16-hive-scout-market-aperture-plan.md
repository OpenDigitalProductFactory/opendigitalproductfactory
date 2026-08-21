# Plan — Hive Scout market aperture: daily inbound product intelligence (BI-B8E4317D)

**Date:** 2026-08-16
**Spec:** docs/superpowers/specs/2026-08-16-hive-scout-market-aperture-design.md
**Epic:** EP-5EA15B45 · **Blocker context:** BI-FC28F1E3 (verified, evidence recorded)

## Backlog coverage

**Umbrella item:** BI-B8E4317D. Coverage decision: **atomic** — the source list, market pass, prompt reshaping, and summary surfacing are one behavioural unit (a source list without the pass does nothing, the pass without the prompt produces unread material, and the prompt without the pass hallucinates); no phase is independently shippable. Dependencies: none.

**Governed coverage receipt: blocked by BI-72F368BC** (BI-B9403248 is fixed). The original block was BI-B9403248: `record_plan_backlog_coverage` (schema v2) rejected every external CLI session with `plan-artifact-invalid`, because its repository-artifact check required a capsule `headSha` no governed tool set, a `PrincipalAlias` for the install DCO identity that did not exist, and exactly one agent-recorded capsule activity an external session cannot produce — contradicting the §12 keystone that governance approves evidence, not provenance. That defect is fixed and verified against the live install: the artifact now resolves for an external-shaped capsule (human principal, no agent provenance). A second, distinct gate remains and is filed as BI-72F368BC: v2 coverage also requires an `initiative_scope_baseline`, of which **zero** exist install-wide, because the only writer is the `spec-approval` lane and that lane requires a reviewer independent of the artifact author — unreachable while the install has a single human principal. Restore this section's governed coverage block (marker + live receipt) when BI-72F368BC ships.

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
