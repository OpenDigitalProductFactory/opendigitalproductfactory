# Marketing Execution Loop — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / dpf-platform:dpf-writing-plans.

**Goal:** Third external channel — paid ads — with hard spend gates and KPI pullback into the existing `MarketingKpiCheckpoint`. LinkedIn Ads first (reuses the Phase 2 LinkedIn developer app + adds `r_ads` / `rw_ads` scopes). Google Ads is Phase 4b once LinkedIn proves the gate pattern. Per spec §6.4 + §7 Phase 4 + §13.

**Architecture:** A new `MarketingChannelSpendCeiling` Prisma model records the operator's weekly spend cap per channel. The publish service grows a spend-validation hook that runs BEFORE the adapter's `place-ad` call: it sums the past-7-days `OutboundPublication.channelMetadata.spendCents` for the channel and refuses if the new placement would cross the ceiling. Per-placement caps live on the draft's `metadata.dailyBudgetCents` / `metadata.totalBudgetCents` and get validated against the LinkedIn Ads API's `dailyBudget`/`lifetimeBudget` fields. The adapter still requests fresh per-spend approval — the operator clicks "Place ad" knowing the proposed cost; the ceiling guard is the second backstop.

The KPI pullback service runs on demand for Phase 4 (a manual "refresh metrics" action + a periodic poller that customers can wire to whatever scheduler their install uses). Phase 5's scheduler will run it on a cron. Pullback flow: walk recent `OutboundPublication` rows still inside their 30-day analytics window, call adapter `fetchEngagement`, write the snapshot to `OutboundPublication.lastMetricsSnapshot`, and aggregate into a `MarketingKpiCheckpoint` row with the channel-rolled-up impressions/clicks/CPC/CPL so the next Marketing Strategist review sees real numbers via `get_marketing_summary`.

**Reference spec:** `docs/superpowers/specs/2026-05-26-marketing-execution-loop-design.md` §6.4 + §7 Phase 4 + §10 + §13.

---

## UX Architecture Fit Gate

- **Feature:** Place paid LinkedIn ads from approved ad creatives with per-spend approval + weekly channel ceiling + KPI pullback.
- **Owning area:** Business > Customer > Marketing.
- **Primary route family:** `/customer/marketing`.
- **Primary persona:** Mark Bodman as CEO setting spend ceilings + approving individual placements.
- **Job the first viewport helps complete:** "See last week's spend / impressions / CPC, decide whether to place the next ad."
- **Navigation layer touched:** local route + contextual action only.
- **Existing component or pattern reused:** `MarketingStrategyOverview` panel shape for the spend ceiling card. Approval queue rows for `assetType=ad-creative` get an extended drawer with budget + audience + spend cap fields. New `PlaceAdButton` mirrors `PublishLinkedInButton`'s shape.
- **New component justified because:** ad placement carries spend risk; we need an explicit per-placement confirmation surface that shows projected cost, current weekly spend, ceiling headroom, and a typed-confirmation Place button. Reusing the existing Approve→Publish two-step is not safe enough for ad spend.
- **Source-of-truth model or service:** `MarketingChannelSpendCeiling` (new) holds the weekly cap per channel. `OutboundPublication.channelMetadata.spendCents` (existing field, new use) holds the per-placement actual. KPI rollup writes to `MarketingKpiCheckpoint` (existing).
- **Empty state behavior:** "No ad spend recorded yet. Set a weekly channel ceiling and approve an ad creative to start." One concrete next action.
- **Failure / unavailable behavior:** spend-cap rejection returns a clear "would exceed weekly ceiling by $N" error. Ad API failures are classified retryable vs. permanent. KPI pullback failures are non-fatal — they log and skip; the next run picks up.
- **AI or coworker action boundary:** ad placement is human-only — no `OutboundAutopilotPolicy` can place ads, ever (per spec §13). Ceiling raising is operator-only, gated by `manage_provider_connections`.
- **Theme and layout checks:** all colors via `var(--dpf-*)` tokens.
- **Routes to verify:** `/customer/marketing` (spend dashboard + placement flow) + `/platform/tools/integrations/linkedin-personal-social` (extended for ads scope).

---

## Phase 0: Branch and Substrate Guard

- [x] Worktree on `feat/marketing-execution-loop-phase-4`, branched from `origin/main`.
- [x] Substrate sweep — no existing `MarketingChannelSpendCeiling`.
- [x] Re-read spec §6.4 + §7 Phase 4 + §13.

## Phase 1: Prisma Model + Migration

- [ ] Add `MarketingChannelSpendCeiling` to `packages/db/prisma/schema.prisma`. Per-organization × per-channel record with weekly cap, last-set-by, last-set-at.
- [ ] Hand-author migration `20260603020000_marketing_execution_spend_ceiling`. Apply to live `dpf-postgres-1` + record in `_prisma_migrations`.
- [ ] Regenerate Prisma client.

## Phase 2: Spend Gate

- [ ] New file `apps/web/lib/marketing/spend-gate.ts` exporting `assertSpendWithinCeiling({ organizationId, channelId, proposedSpendCents, now })`:
  - Reads `MarketingChannelSpendCeiling` for `(organizationId, channelId)`. Refuses if no ceiling exists (operator must explicitly set one before placing ads).
  - Reads sum of `OutboundPublication.channelMetadata.spendCents` for the same channel in the rolling 7-day window ending at `now`.
  - Returns `{ ok: true, headroomCents }` or `{ ok: false, reason, currentSpendCents, ceilingCents }`.
- [ ] Wire spend-gate into `publishApprovedDraft` for channels whose adapter declares `place-ad` capability.

## Phase 3: LinkedIn Ads Channel Adapter

- [ ] New folder `apps/web/lib/marketing/channels/linkedin-ads/`:
  - `client.ts` — wraps `/v2/adAccountsV2/{id}` (account validation), `/v2/adCreativesV2` (create creative), `/v2/adCampaignsV2` (create campaign with `dailyBudget`/`lifetimeBudget`), and `/v2/adAnalyticsV2` (fetch engagement). Mockable via `fetchImpl`.
  - `adapter.ts` — implements `OutboundChannelAdapter` with `place-ad` + `fetch-engagement` capabilities. `validateDraft` requires `metadata.dailyBudgetCents` AND `metadata.audienceUrn` AND `metadata.adAccountUrn` for ad-creative drafts. `publish` creates the creative + campaign + assigns spend cap. `fetchEngagement` queries adAnalyticsV2 for the campaign URN and returns `{ impressions, clicks, costInUsdCents, conversions }`.
  - `ADS_MOCK_MODE=1` env flag for the publish + fetchEngagement paths.
- [ ] Extend the LinkedIn Personal Social integration's OAuth flow to OPTIONALLY request `r_ads` + `rw_ads` scopes via a separate "Enable LinkedIn Ads" button on the connect page (so the basic personal-publish flow stays minimal-scope per spec §10).

## Phase 4: place_linkedin_ad MCP Tool

- [ ] New `place_linkedin_ad(draftId)` MCP tool. Same gating shape as `publish_to_linkedin` PLUS spend-gate validation. Returns a structured failure if the spend ceiling would be crossed.
- [ ] `TOOL_TO_GRANTS["place_linkedin_ad"] = ["marketing_write"]`.
- [ ] Marketing-specialist prompt updated: ad placement is human-only; never call `place_linkedin_ad` without an explicit user confirmation in the conversation that mentions a specific spend amount and audience.

## Phase 5: KPI Pullback Service

- [ ] New file `apps/web/lib/marketing/kpi-pullback.ts` exporting:
  - `pullChannelKpis({ channelId, sinceDaysAgo? }): Promise<{ snapshotsWritten: number; checkpointsWritten: number }>`.
  - Walks `OutboundPublication` rows for the channel where `publishedAt > now - 30 days`, calls the adapter's `fetchEngagement`, writes `lastMetricsSnapshot` + `lastMetricsPolledAt`, aggregates by channel + rolling-7-day window into one `MarketingKpiCheckpoint` row per channel.
- [ ] New `refresh_channel_kpis(channelId)` MCP tool exposing the pullback service to the strategist agent.

## Phase 6: Spend Ceiling UI

- [ ] New `MarketingSpendCeilingPanel` component on `/customer/marketing` showing per-channel weekly ceiling + current week spend + headroom + a Set/Update button (gated by `manage_provider_connections`).
- [ ] New `PlaceAdButton` client component on the "Ready to publish" section for ad-creative drafts. Disabled until spend ceiling exists + ad-account-urn captured + ads OAuth scope granted. Surfaces projected spend + ceiling headroom before the user clicks Place.
- [ ] Approval queue inline-edit drawer grows budget/audience/ad-account fields for `assetType=ad-creative` drafts (read-only summary in the row, editable in the drawer).

## Phase 7: Tests

- [ ] `apps/web/lib/marketing/spend-gate.test.ts`: ceiling-not-set rejected, headroom calculation correct, rolling-7-day window respected, would-exceed rejected with diff numbers.
- [ ] `apps/web/lib/marketing/channels/linkedin-ads/adapter.test.ts`: validate rejects missing budget / missing audience / wrong asset type; publish happy path; 401/403 (insufficient scope); 429 retryable; mock-mode.
- [ ] `apps/web/lib/marketing/kpi-pullback.test.ts`: pullback writes snapshots + aggregates correctly; failure on one row doesn't break the others.
- [ ] Marketing execution catalog: `assetType=ad-creative` added.

## Phase 8: Build Gate

- [ ] vitest passing for the marketing surface.
- [ ] `pnpm --filter web typecheck` clean.
- [ ] `pnpm --filter web exec next build` exit 0.
- [ ] Migration applies on `dpf-postgres-1`.

## Phase 9: UX Verification (mock mode)

- [ ] Seed: `MarketingChannelSpendCeiling(channelId=linkedin-ads, weeklyCapCents=2000_00)`, approved ad-creative draft with `metadata.dailyBudgetCents=500_00`, `metadata.audienceUrn`, `metadata.adAccountUrn`.
- [ ] Set `ADS_MOCK_MODE=1` in the install env.
- [ ] Drive `place_linkedin_ad` — verify OutboundPublication row with spend metadata, draft flipped to published.
- [ ] Second placement that would exceed ceiling — verify rejection with the right error shape.
- [ ] Call `refresh_channel_kpis(linkedin-ads)` — verify `lastMetricsSnapshot` updated + `MarketingKpiCheckpoint` row written.

## Phase 10: Ship + Operator Handoff

- [ ] DCO-signed commit, push branch, open PR.
- [ ] Update `docs/operations/integrations/linkedin-personal-social-setup.md` with the optional "Enable LinkedIn Ads" steps (add ads product to your LinkedIn app + ad-account URN + ad-creative requirements).

---

## Definition of Done

- All Phase 4 build-gate steps pass.
- LinkedIn Ads adapter passes unit tests for validate + spend-gate + mock-mode + error classification.
- Spend ceiling refuses placements that would exceed the cap.
- KPI pullback writes visible `MarketingKpiCheckpoint` evidence.
- Marketing-specialist prompt updated: never place ads autonomously.
- `BI-5133E808` flipped to `done`.
